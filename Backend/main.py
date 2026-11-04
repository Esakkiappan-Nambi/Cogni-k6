from fastapi import FastAPI, HTTPException
from sqlalchemy.orm import Session
from csv_handler import save_csv
from database import SessionLocal, engine, Base
from fastapi import Depends
from auth import get_current_user
import re
import sys
import time
import http.client
from urllib.parse import urlsplit
from router.auto_capture import router as auto_capture_router  # ← uncommented & fixed
from router.recorder import router as recorder_router
from models import User, Test, TestRun, Report
from schemas import RegisterUser, LoginUser
import json
from auth import hash_password, verify_password, create_access_token
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime, timezone
import subprocess
import threading
from schemas import TestCreate
import os
from typing import Annotated
from swagger_import import discover_apis_from_swagger
import uuid
from fastapi import Form, File, UploadFile, BackgroundTasks
from k6_runner import generate_k6_script, execute_k6, generate_pdf_report
import signal

Base.metadata.create_all(bind=engine)

app = FastAPI()

# ── Mount routers ─────────────────────────────────────────────────────────────
app.include_router(auto_capture_router)  # registers POST /auto-capture
app.include_router(recorder_router)      # registers /recorder/* endpoints

# ── Scheduler ─────────────────────────────────────────────────────────────────
scheduler = BackgroundScheduler()
scheduler.start()

# ── Global process tracker (for stop-test) ────────────────────────────────────
running_processes: dict = {}

SCRIPT_FOLDER = "generated_scripts"
P90_METRIC = "p(90)"
P95_METRIC = "p(95)"


# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "").split(",")
        if origin.strip()
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── DB dependency ─────────────────────────────────────────────────────────────
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


DatabaseSession = Annotated[Session, Depends(get_db)]
AuthenticatedUser = Annotated[User, Depends(get_current_user)]


# ── Metric helpers ────────────────────────────────────────────────────────────

def convert_to_ms(value):
    if "ms" in value:
        return float(value.replace("ms", ""))
    elif "s" in value:
        return float(value.replace("s", "")) * 1000
    return float(value)


def extract_metrics(summary_data, output, summary_path=None):
    if not summary_data and summary_path:
        with open(summary_path, "r", encoding="utf-8") as f:
            summary_data = json.load(f)

    metrics = summary_data.get("metrics", {})

    http_reqs = metrics.get("http_reqs", {})
    duration  = metrics.get("http_req_duration", {})
    checks    = metrics.get("checks", {})
    failed    = metrics.get("http_req_failed", {})

    return {
        "total_requests":    http_reqs.get("count", 0),
        "throughput":        http_reqs.get("rate", 0),
        "avg_response_time": duration.get("avg", 0),
        "min_response_time": duration.get("min", 0),
        "max_response_time": duration.get("max", 0),
        "p90":               duration.get(P90_METRIC, 0),
        "p95":               duration.get(P95_METRIC, 0),
        "failed_requests":   checks.get("fails", 0),
        "passed_checks":     checks.get("passes", 0),
        "error_rate":        failed.get("value", 0) * 100,
    }


# ── Step / schedule normalisers ───────────────────────────────────────────────

def _normalise_step(step: dict) -> dict:
    """Validate and fill defaults for one scenario step."""
    if not step.get("url"):
        raise ValueError(f"URL missing in step: {step.get('name')}")

    step["thinkTime"] = int(step.get("thinkTime") or 0)
    step["headers"]   = step.get("headers") or "{}"
    step["body"]      = step.get("body") or "{}"

    retry = step.get("retry") or {}
    step["retry"] = {
        "enabled":        bool(retry.get("enabled", False)),
        "maxRetries":     int(retry.get("maxRetries", 3)),
        "retryDelay":     int(retry.get("retryDelay", 1000)),
        "retryOn":        retry.get("retryOn", [500, 502, 503]),
        "retryOnTimeout": bool(retry.get("retryOnTimeout", True)),
    }
    return step


def _parse_schedule(schedule_str) -> dict | None:
    if not schedule_str:
        return None
    try:
        data = json.loads(schedule_str)
    except Exception:
        raise ValueError("Invalid schedule JSON")

    if not data.get("startTime"):
        raise ValueError("schedule.startTime is required when scheduling is enabled")

    return {
        "startTime": data.get("startTime", ""),
        "endTime":   data.get("endTime", ""),
        "frequency": data.get("frequency", "once"),
    }


# ── Auth endpoints ────────────────────────────────────────────────────────────

@app.post("/register")
def register_user(user: RegisterUser, db: DatabaseSession):
    existing_user = db.query(User).filter(User.email == user.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    if user.password != user.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")

    new_user = User(
        full_name=user.full_name,
        email=user.email,
        password=hash_password(user.password),
        confirm_password=hash_password(user.confirm_password),
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"message": "User registered successfully"}


@app.post("/login")
def login_user(user: LoginUser, db: DatabaseSession):
    db_user = db.query(User).filter(User.email == user.email).first()
    if not db_user:
        raise HTTPException(status_code=401, detail="Invalid Credentials")
    if not verify_password(user.password, db_user.password):
        raise HTTPException(status_code=401, detail="Invalid Credentials")

    token = create_access_token({"sub": db_user.email})
    return {
        "access_token": token,
        "token_type":   "bearer",
        "full_name":    db_user.full_name,
        "email":        db_user.email,
    }


@app.get("/verify-token")
def verify_token(current_user: AuthenticatedUser):
    return {"valid": True, "user": current_user.email}


# ── Test CRUD ─────────────────────────────────────────────────────────────────

@app.post("/create-test")
def create_test(
    test_name:               str        = Form(...),
    users:                   int        = Form(...),
    duration:                int        = Form(...),
    ramp_up:                 int        = Form(...),
    loop_count:              int        = Form(...),
    scenario:                str        = Form(...),
    assertions:              str        = Form(None),
    enable_csv:              bool       = Form(False),
    variable_name:           str        = Form(None),
    csv_file:                UploadFile = File(None),
    enable_cookie_manager:   bool       = Form(False),
    cookie_config:           str        = Form(None),
    enable_cache_manager:    bool       = Form(False),
    cache_config:            str        = Form(None),
    enable_udv:              bool       = Form(False),
    user_defined_variables:  str        = Form(None),
    enable_scheduling:       bool       = Form(False),
    schedule:                str        = Form(None),
    *,
    db: DatabaseSession,
    current_user: AuthenticatedUser,
):
    # ── Parse scenario ────────────────────────────────────────────────────────
    try:
        scenario_data = json.loads(scenario)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid scenario JSON")

    assertions_data = None
    if assertions:
        try:
            assertions_data = json.loads(assertions)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid assertions JSON")

    udv_data = []
    if enable_udv and user_defined_variables:
        try:
            udv_data = json.loads(user_defined_variables)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid UDV JSON")

    cookie_clear_each_iteration = False
    cookie_user_cookies = []
    cookie_policy_str = "strict"
    if enable_cookie_manager and cookie_config:
        try:
            parsed_cookie = json.loads(cookie_config)
            cookie_clear_each_iteration = parsed_cookie.get("clearEachIteration", False)
            cookie_user_cookies = parsed_cookie.get("userCookies") or parsed_cookie.get("cookies", [])
            cookie_policy_str = json.dumps({
                "policy": parsed_cookie.get("policy", "strict"),
                "userCookies": cookie_user_cookies,
                "clearEachIteration": cookie_clear_each_iteration
            })
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid cookie config")

    cache_clear_each_iteration = False
    cache_max_size = 75
    if enable_cache_manager and cache_config:
        try:
            parsed_cache = json.loads(cache_config)
            cache_clear_each_iteration = parsed_cache.get("clearEachIteration", False)
            cache_max_size = int(parsed_cache.get("maxSize", 75))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid cache config")

    schedule_data = None
    if enable_scheduling:
        try:
            schedule_data = _parse_schedule(schedule)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    try:
        scenario_data = [_normalise_step(s) for s in scenario_data]
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    csv_path = None
    if enable_csv:
        if not csv_file:
            raise HTTPException(status_code=400, detail="CSV file required")
        csv_path = save_csv(csv_file)

    script_path = generate_k6_script(
        test_name=test_name,
        users=users,
        duration=duration,
        ramp_up=ramp_up,
        loop_count=loop_count,
        scenario=scenario_data,
        assertions=assertions_data,
        csv_enabled=enable_csv,
        csv_path=csv_path,
        csv_variables=variable_name,
        cookie_enabled=enable_cookie_manager,
        cookie_clear_each_iteration=cookie_clear_each_iteration,
        cache_enabled=enable_cache_manager,
        cache_clear_each_iteration=cache_clear_each_iteration,
        cache_max_size=cache_max_size,
        user_defined_variables=udv_data,
        schedule_enabled=enable_scheduling,
        schedule=schedule_data,
        cookie_user_cookies=cookie_user_cookies,
    )

    new_test = Test(
        test_name=test_name,
        users=users,
        duration=duration,
        ramp_up=ramp_up,
        loop_count=loop_count,
        scenario=json.dumps(scenario_data),
        assertions=json.dumps(assertions_data) if assertions_data else None,
        script_path=script_path,
        status="Created",
        csv_enabled=enable_csv,
        csv_path=csv_path,
        csv_variables=variable_name,
        cookie_enabled=enable_cookie_manager,
        cookie_clear_each_iteration=cookie_clear_each_iteration,
        cookie_policy=cookie_policy_str,
        cache_enabled=enable_cache_manager,
        cache_clear_each_iteration=cache_clear_each_iteration,
        cache_max_size=cache_max_size,
        udv_enabled=enable_udv,
        user_defined_variables=json.dumps(udv_data) if udv_data else None,
        schedule_enabled=enable_scheduling,
        schedule=json.dumps(schedule_data) if schedule_data else None,
        user_id=current_user.id,
    )

    db.add(new_test)
    db.commit()
    db.refresh(new_test)

    # ── Schedule if requested ─────────────────────────────────────────────────
    try:
        scheduler.remove_job(f"test_{new_test.id}")
    except Exception:
        pass

    if new_test.schedule_enabled and new_test.schedule:
        try:
            sched = json.loads(new_test.schedule)
            start_time = datetime.fromisoformat(sched["startTime"])
            scheduler.add_job(
                id=f"test_{new_test.id}",
                func=run_scheduled_test,
                trigger="date",
                run_date=start_time,
                args=[new_test.id],
                replace_existing=True,
            )
            new_test.status = "scheduled"
            db.commit()
            print(f"[scheduler] Test {new_test.id} scheduled for {start_time}")
        except Exception as e:
            print(f"[scheduler] Schedule registration failed: {e}")

    return {"message": "Test Created Successfully", "test_id": new_test.id}




@app.put("/update-test/{test_id}")
def update_test(
    test_id:                 int,
    test_name:               str        = Form(...),
    users:                   int        = Form(...),
    duration:                int        = Form(...),
    ramp_up:                 int        = Form(...),
    loop_count:              int        = Form(...),
    scenario:                str        = Form(...),
    assertions:              str        = Form(None),
    enable_csv:              bool       = Form(False),
    variable_name:           str        = Form(None),
    csv_file:                UploadFile = File(None),
    enable_cookie_manager:   bool       = Form(False),
    cookie_config:           str        = Form(None),
    enable_cache_manager:    bool       = Form(False),
    cache_config:            str        = Form(None),
    enable_udv:              bool       = Form(False),
    user_defined_variables:  str        = Form(None),
    enable_scheduling:       bool       = Form(False),
    schedule:                str        = Form(None),
    *,
    db: DatabaseSession,
    current_user: AuthenticatedUser,
):
    test = db.query(Test).filter(Test.id == test_id).first()
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    if test.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    try:
        scenario_data = json.loads(scenario)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid scenario JSON")

    assertions_data = None
    if assertions:
        try:
            assertions_data = json.loads(assertions)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid assertions JSON")

    udv_data = []
    if enable_udv and user_defined_variables:
        try:
            udv_data = json.loads(user_defined_variables)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid UDV JSON")

    cookie_clear_each_iteration = False
    cookie_user_cookies = []
    cookie_policy_str = "strict"
    if enable_cookie_manager and cookie_config:
        try:
            parsed_cookie = json.loads(cookie_config)
            cookie_clear_each_iteration = parsed_cookie.get("clearEachIteration", False)
            cookie_user_cookies = parsed_cookie.get("userCookies") or parsed_cookie.get("cookies", [])
            cookie_policy_str = json.dumps({
                "policy": parsed_cookie.get("policy", "strict"),
                "userCookies": cookie_user_cookies,
                "clearEachIteration": cookie_clear_each_iteration
            })
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid cookie config")

    cache_clear_each_iteration = False
    cache_max_size = 75
    if enable_cache_manager and cache_config:
        try:
            parsed_cache = json.loads(cache_config)
            cache_clear_each_iteration = parsed_cache.get("clearEachIteration", False)
            cache_max_size = int(parsed_cache.get("maxSize", 75))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid cache config")

    schedule_data = None
    if enable_scheduling:
        try:
            schedule_data = _parse_schedule(schedule)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    try:
        scenario_data = [_normalise_step(s) for s in scenario_data]
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if enable_csv and csv_file:
        upload_folder = "uploads"
        os.makedirs(upload_folder, exist_ok=True)
        file_path = os.path.join(upload_folder, csv_file.filename)
        with open(file_path, "wb") as f:
            f.write(csv_file.file.read())
        test.csv_path = file_path

    script_path = generate_k6_script(
        test_name=test_name,
        users=users,
        duration=duration,
        ramp_up=ramp_up,
        loop_count=loop_count,
        scenario=scenario_data,
        assertions=assertions_data,
        csv_enabled=enable_csv,
        csv_path=test.csv_path,
        csv_variables=variable_name,
        cookie_enabled=enable_cookie_manager,
        cookie_clear_each_iteration=cookie_clear_each_iteration,
        cache_enabled=enable_cache_manager,
        cache_clear_each_iteration=cache_clear_each_iteration,
        cache_max_size=cache_max_size,
        user_defined_variables=udv_data,
        schedule_enabled=enable_scheduling,
        schedule=schedule_data,
        cookie_user_cookies=cookie_user_cookies,
    )

    test.test_name                   = test_name
    test.users                       = users
    test.duration                    = duration
    test.ramp_up                     = ramp_up
    test.loop_count                  = loop_count
    test.scenario                    = json.dumps(scenario_data)
    test.assertions                  = json.dumps(assertions_data) if assertions_data else None
    test.csv_enabled                 = enable_csv
    test.csv_variables               = variable_name
    test.cookie_enabled              = enable_cookie_manager
    test.cookie_clear_each_iteration = cookie_clear_each_iteration
    test.cookie_policy               = cookie_policy_str
    test.cache_enabled               = enable_cache_manager
    test.cache_clear_each_iteration  = cache_clear_each_iteration
    test.cache_max_size              = cache_max_size
    test.udv_enabled                 = enable_udv
    test.user_defined_variables      = json.dumps(udv_data) if udv_data else None
    test.script_path                 = script_path
    test.schedule_enabled            = enable_scheduling
    test.schedule                    = json.dumps(schedule_data) if schedule_data else None

    db.commit()
    db.refresh(test)

    # ── Re-register schedule ──────────────────────────────────────────────────
    try:
        scheduler.remove_job(f"test_{test_id}")
    except Exception:
        pass

    if test.schedule_enabled and test.schedule:
        try:
            sched = json.loads(test.schedule)
            start_time = datetime.fromisoformat(sched["startTime"])
            scheduler.add_job(
                id=f"test_{test_id}",
                func=run_scheduled_test,
                trigger="date",
                run_date=start_time,
                args=[test_id],
                replace_existing=True,
            )
            test.status = "scheduled"
            db.commit()
        except Exception as e:
            print(f"[scheduler] Schedule update failed: {e}")

    return {"message": "Test updated successfully", "test_id": test.id}


@app.delete("/delete-test/{test_id}")
def delete_test(test_id: int, db: DatabaseSession):
    test = db.query(Test).filter(Test.id == test_id).first()
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")

    script_path = os.path.join(SCRIPT_FOLDER, f"{test.test_name}.js")
    db.delete(test)
    db.commit()

    if os.path.exists(script_path):
        os.remove(script_path)

    return {"message": "Test deleted successfully"}


# ── Test execution ────────────────────────────────────────────────────────────

def terminate_k6_process(run_id: int):
    proc = running_processes.get(run_id)
    if proc:
        try:
            if sys.platform == "win32":
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
            else:
                proc.terminate()
        except Exception as e:
            print(f"[k6] Error killing process {proc.pid}: {e}")
        finally:
            running_processes.pop(run_id, None)


def run_k6_in_background(test_id: int, test_run_id: int, script_path: str, assertions_raw):
    """
    Runs k6 in a background thread with its own DB session.
    Never call this from the FastAPI request thread.
    """
    db = SessionLocal()
    try:
        print(f"[k6] Starting test_id={test_id} run_id={test_run_id}")

        test_obj = db.query(Test).filter(Test.id == test_id).first()
        live_telemetry[test_run_id] = {
            "id": test_run_id,
            "test_name": test_obj.test_name if test_obj else "Scenario",
            "status": "running",
            "output": "",
            "throughput": 0.0,
            "avg_response_time": 0.0,
            "min_response_time": 0.0,
            "max_response_time": 0.0,
            "p90": 0.0,
            "p95": 0.0,
            "error_rate": 0.0,
            "total_requests": 0,
            "failed_requests": 0,
            "passed_checks": 0,
            "active_vus": test_obj.users if test_obj else 1,
            "started_at": datetime.now(timezone.utc).isoformat()
        }

        def on_started(proc):
            running_processes[test_run_id] = proc
            running_processes[f"test_{test_id}"] = proc

        def on_chunk(line):
            data = live_telemetry.get(test_run_id)
            if not data:
                return
            data["output"] += line
            # Parse real-time k6 output
            m_reqs = re.search(
                r'http_reqs[.]*:\s*(\d+)\s+(\d+(?:\.\d+)?)/s',
                line,
            )
            if m_reqs:
                data["total_requests"] = int(m_reqs.group(1))
                data["throughput"] = float(m_reqs.group(2))
            duration_line = re.search(
                r"http_req_duration[.]*:\s*(.*)",
                line,
            )
            if duration_line:
                duration_values = dict(
                    (name, (float(value), unit))
                    for name, value, unit in re.findall(
                        r"\b(avg|p\(90\)|p\(95\))="
                        r"(\d+(?:\.\d+)?)(ms|s)\b",
                        duration_line.group(1),
                    )
                )
                if {"avg", P90_METRIC, P95_METRIC} <= duration_values.keys():
                    data["avg_response_time"] = duration_values["avg"][0]
                    data["p90"] = duration_values[P90_METRIC][0]
                    data["p95"] = duration_values[P95_METRIC][0]
            m_vus = re.search(r'(\d+)/(\d+)\s+VUs', line)
            if m_vus:
                data["active_vus"] = int(m_vus.group(1))
            m_fail = re.search(r'http_req_failed\.*:\s*([\d\.]+)%', line)
            if m_fail:
                data["error_rate"] = float(m_fail.group(1))
            m_checks = re.search(r'checks\.*:\s*([\d\.]+)%\s*✓\s*(\d+)\s*✗\s*(\d+)', line)
            if m_checks:
                data["passed_checks"] = int(m_checks.group(2))
                data["failed_requests"] = int(m_checks.group(3))

        output, summary_data, summary_path = execute_k6(
            script_path, test_run_id,
            on_process_created=on_started,
            on_output_chunk=on_chunk
        )
        metrics = extract_metrics(summary_data, output, summary_path)

        print(
            f"[k6] Finished — total={metrics['total_requests']} "
            f"error_rate={metrics['error_rate']:.1f}% "
            f"avg_rt={metrics['avg_response_time']:.0f}ms"
        )

        test = db.query(Test).filter(Test.id == test_id).first()
        test_run = db.query(TestRun).filter(TestRun.id == test_run_id).first()
        test_name = test.test_name if test else "Unknown"

        pdf_report_path = generate_pdf_report(test_run_id, test_name, metrics, output)

        assertions = {}
        if assertions_raw:
            assertions = json.loads(assertions_raw) if isinstance(assertions_raw, str) else assertions_raw

        # ── Determine pass / fail / stopped ───────────────────────────────────
        if test_run and test_run.status in ("stopping", "stopped"):
            status = "stopped"
        else:
            status = "completed"
            if not summary_data or not summary_data.get("metrics"):
                status = "failed"
                print("[k6] Failed: no summary data")
            elif metrics["total_requests"] == 0:
                status = "failed"
                print("[k6] Failed: zero requests")
            elif metrics["error_rate"] >= 100:
                status = "failed"
                print("[k6] Failed: 100% error rate")
            elif assertions and (assertions.get("max_response_time") or assertions.get("max_error_rate") is not None):
                if assertions.get("max_response_time") and metrics["avg_response_time"] > float(assertions["max_response_time"]):
                    status = "failed"
                    print(f"[k6] Failed SLA: avg_response_time {metrics['avg_response_time']:.1f}ms > {assertions['max_response_time']}ms")
                elif assertions.get("max_error_rate") is not None and metrics["error_rate"] > float(assertions["max_error_rate"]):
                    status = "failed"
                    print(f"[k6] Failed SLA: error_rate {metrics['error_rate']:.1f}% > {assertions['max_error_rate']}%")
            elif metrics.get("failed_requests", 0) > 0 and metrics["error_rate"] > 50:
                status = "failed"
                print(f"[k6] Failed: high error rate {metrics['error_rate']:.1f}%")

        print(f"[k6] Final status: {status}")

        report = Report(
            execution_id=test_run_id,
            avg_response_time=metrics["avg_response_time"],
            min_response_time=metrics["min_response_time"],
            max_response_time=metrics["max_response_time"],
            requests_per_second=metrics["throughput"],
            total_requests=metrics["total_requests"],
            failed_requests=metrics["failed_requests"],
            passed_checks=metrics["passed_checks"],
            error_rate=metrics["error_rate"],
            p90=metrics["p90"],
            p95=metrics["p95"],
            output=output,
            report_path=pdf_report_path,
        )
        db.add(report)

        if test:
            test.status = status
        if test_run:
            test_run.status = status
            test_run.output = output

        db.commit()
        print(f"[k6] DB updated — run_id={test_run_id} status={status}")

    except Exception as e:
        print(f"[k6] Exception: {e}")
        try:
            db.rollback()
            test     = db.query(Test).filter(Test.id == test_id).first()
            test_run = db.query(TestRun).filter(TestRun.id == test_run_id).first()
            if test and test.status != "stopped":
                test.status = "failed"
            if test_run and test_run.status != "stopped":
                test_run.status = "failed"
                test_run.output = str(e)
            db.commit()
        except Exception as inner:
            print(f"[k6] Could not mark as failed: {inner}")
    finally:
        live_telemetry.pop(test_run_id, None)
        running_processes.pop(test_run_id, None)
        running_processes.pop(f"test_{test_id}", None)
        db.close()


@app.post("/run-test/{test_id}")
def run_test(
    test_id: int,
    background_tasks: BackgroundTasks,
    db: DatabaseSession,
    current_user: AuthenticatedUser,
):
    test = db.query(Test).filter(Test.id == test_id).first()
    if not test:
        raise HTTPException(status_code=404, detail="Test Not Found")
    if not test.script_path or not os.path.exists(test.script_path):
        raise HTTPException(
            status_code=400,
            detail="Test script not found. Please re-save the test.",
        )

    test.status = "running"
    test_run = TestRun(
        test_id=test.id,
        user_id=current_user.id,
        status="running",
        output="",
    )
    db.add(test_run)
    db.commit()
    db.refresh(test_run)

    background_tasks.add_task(
        run_k6_in_background,
        test_id=test.id,
        test_run_id=test_run.id,
        script_path=test.script_path,
        assertions_raw=test.assertions,
    )

    return {
        "run_id":  test_run.id,
        "test_id": test.id,
        "status":  "running",
        "message": "Test started. Poll /report/{run_id} for status.",
    }


@app.post("/stop-test/{test_id}")
def stop_test(
    test_id: int,
    db: DatabaseSession,
    current_user: AuthenticatedUser,
):
    """
    Terminates the active k6 process immediately and marks status as stopped.
    """
    test = db.query(Test).filter(Test.id == test_id).first()
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")

    active_run = (
        db.query(TestRun)
        .filter(TestRun.test_id == test_id, TestRun.status.in_(["running", "stopping"]))
        .first()
    )

    test.status = "stopped"
    if active_run:
        active_run.status = "stopped"
        db.commit()
        terminate_k6_process(active_run.id)
    else:
        db.commit()

    proc = running_processes.pop(f"test_{test_id}", None)
    if proc:
        try:
            if sys.platform == "win32":
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
            else:
                proc.terminate()
        except Exception:
            pass

    return {"message": "Test stopped successfully"}


# ── Query endpoints ───────────────────────────────────────────────────────────

@app.get("/tests")
def get_tests(db: DatabaseSession, current_user: AuthenticatedUser):
    tests = db.query(Test).filter(Test.user_id == current_user.id).all()
    result = []
    for test in tests:
        latest_run = (
            db.query(TestRun)
            .filter(TestRun.test_id == test.id)
            .order_by(TestRun.id.desc())
            .first()
        )
        result.append({
            "id":         test.id,
            "test_name":  test.test_name,
            "users":      test.users,
            "duration":   test.duration,
            "status":     latest_run.status if latest_run else "Not Run",
            "created_at": test.created_at,
        })
    return result


@app.get("/test-runs")
def get_test_runs(db: DatabaseSession, current_user: AuthenticatedUser):
    runs = (
        db.query(TestRun)
        .join(Test, Test.id == TestRun.test_id)
        .filter(Test.user_id == current_user.id)
        .order_by(TestRun.id.desc())
        .all()
    )
    result = []
    for run in runs:
        test = db.query(Test).filter(Test.id == run.test_id).first()
        result.append({
            "id":         run.id,
            "test_id":    run.test_id,
            "test_name":  test.test_name if test else "Unknown",
            "status":     run.status,
            "started_at": run.started_at,
        })
    return result


@app.get("/report/{run_id}")
def get_report(run_id: int, db: DatabaseSession):
    run = db.query(TestRun).filter(TestRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    test   = db.query(Test).filter(Test.id == run.test_id).first()
    report = db.query(Report).filter(Report.execution_id == run.id).first()

    base = {
        "id":         run.id,
        "test_name":  test.test_name if test else "Unknown",
        "status":     run.status,
        "started_at": run.started_at,
    }

    if not report:
        if run.status == "running" and run_id in live_telemetry:
            live = live_telemetry[run_id]
            return {
                **base,
                "throughput": live.get("throughput", 0.0),
                "avg_response_time": live.get("avg_response_time", 0.0),
                "min_response_time": live.get("min_response_time", 0.0),
                "max_response_time": live.get("max_response_time", 0.0),
                "p90": live.get("p90", 0.0),
                "p95": live.get("p95", 0.0),
                "error_rate": live.get("error_rate", 0.0),
                "total_requests": live.get("total_requests", 0),
                "failed_requests": live.get("failed_requests", 0),
                "passed_checks": live.get("passed_checks", 0),
                "active_vus": live.get("active_vus", 1),
                "output": live.get("output", "") or run.output or "",
            }
        return {
            **base,
            "throughput": 0, "avg_response_time": 0, "min_response_time": 0,
            "max_response_time": 0, "p90": 0, "p95": 0, "error_rate": 0,
            "total_requests": 0, "failed_requests": 0, "passed_checks": 0,
            "output": run.output or "",
        }

    return {
        **base,
        "throughput":        round(report.requests_per_second, 2),
        "avg_response_time": round(report.avg_response_time, 2),
        "min_response_time": round(report.min_response_time or 0, 2),
        "max_response_time": round(report.max_response_time or 0, 2),
        "p90":               round(report.p90, 2),
        "p95":               round(report.p95, 2),
        "error_rate":        round(report.error_rate, 2),
        "total_requests":    report.total_requests,
        "failed_requests":   report.failed_requests,
        "passed_checks":     report.passed_checks,
        "output":            report.output,
    }
    
@app.get("/latest-run/{test_id}")
def get_latest_run(test_id: int, db: DatabaseSession):
    latest_run = (
        db.query(TestRun)
        .filter(TestRun.test_id == test_id)
        .order_by(TestRun.id.desc())
        .first()
    )
    if not latest_run:
        raise HTTPException(status_code=404, detail="No runs found")
    return {"run_id": latest_run.id, "status": latest_run.status}


@app.get("/reports")
def get_reports(db: DatabaseSession, current_user: AuthenticatedUser):
    runs = (
        db.query(TestRun, Test.test_name)
        .join(Test, Test.id == TestRun.test_id)
        .filter(Test.user_id == current_user.id)
        .order_by(TestRun.id.desc())
        .all()
    )
    return [
        {
            "id": run.id,
            "test_name": test_name or "Unknown",
            "status": run.status,
            "started_at": run.created_at,
        }
        for run, test_name in runs
    ]
    

# ── Add this import near the top of main.py, with the other imports ──────────
import requests as http_requests


def _preview_authority_key(authority: str) -> str | None:
    try:
        parsed = urlsplit(f"//{authority}")
        port = parsed.port
    except ValueError:
        return None

    if (
        not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        return None

    hostname = parsed.hostname.rstrip(".").casefold()
    if ":" in hostname:
        hostname = f"[{hostname}]"
    return f"{hostname}:{port}" if port is not None else hostname


def _preview_url_is_allowed(url: str) -> bool:
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False

    if parsed.scheme.casefold() not in ("http", "https") or not parsed.netloc:
        return False

    target = _preview_authority_key(parsed.netloc)
    allowed = {
        key
        for item in os.getenv("K6_PREVIEW_ALLOWED_HOSTS", "").split(",")
        if (key := _preview_authority_key(item.strip()))
    }
    return target is not None and target in allowed
 
 
# ── Add this endpoint anywhere among your other @app routes in main.py ───────
# Purpose: lets the Scenario Builder "Run & Preview" button execute ONE step
# server-side (avoids browser CORS issues) and return the real response so
# the user can see actual JSON and pick the right jsonPath — exactly like
# JMeter's "View Results Tree" sampler preview.
 
@app.post(
    "/preview-step",
    responses={
        400: {"description": "Invalid preview request"},
        403: {"description": "Preview target is not allowed"},
        502: {"description": "Preview request failed"},
        504: {"description": "Preview request timed out"},
    },
)
def preview_step(
    payload: dict,
    current_user: Annotated[User, Depends(get_current_user)],
):
    method  = (payload.get("method") or "GET").upper()
    url     = payload.get("url")
    headers = payload.get("headers") or {}
    body    = payload.get("body")
 
    if not isinstance(url, str) or not url.strip():
        raise HTTPException(status_code=400, detail="URL is required")
    if not _preview_url_is_allowed(url):
        raise HTTPException(
            status_code=403,
            detail="Preview target is not allowed",
        )
    if not isinstance(headers, dict):
        headers = {}

    request_kwargs = {
        "headers": headers,
        "timeout": 15,
        "allow_redirects": False,
    }
 
    if method not in ("GET", "DELETE") and body:
        try:
            request_kwargs["json"] = json.loads(body)
        except Exception:
            # Not valid JSON — send as raw text instead of failing outright
            request_kwargs["data"] = body
 
    try:
        # The URL is allowlisted above, credentials are rejected, and redirects are disabled.
        # nosemgrep: python.flask.security.injection.ssrf-requests.ssrf-requests
        resp = http_requests.request(method, url, **request_kwargs)
    except http_requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Request timed out (15s)")
    except http_requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Request failed: {str(e)}")
 
    body_text = resp.text or ""
    body_json = None
    try:
        body_json = resp.json()
    except Exception:
        body_json = None
 
    return {
        "status":     resp.status_code,
        "ok":         resp.ok,
        "headers":    dict(resp.headers),
        "body_text":  body_text[:20000],   # cap payload size sent back to UI
        "body_json":  body_json,
        "elapsed_ms": round(resp.elapsed.total_seconds() * 1000, 1),
    }


@app.post("/preview-script")
def preview_script(
    payload: dict,
    current_user: AuthenticatedUser,
):
    """
    Generates and returns the full k6 JavaScript code without saving to DB,
    allowing the 'Generated k6 Script' tab to show live code syntax.
    """
    test_name = payload.get("testName") or "Preview_Scenario"
    users = int(payload.get("users") or 10)
    duration = int(payload.get("duration") or 30)
    ramp_up = int(payload.get("rampUp") or 5)
    loop_count = int(payload.get("loopCount") or 1)
    scenario = payload.get("scenario") or []
    assertions = payload.get("assertions")
    enable_cookie_manager = bool(payload.get("enableCookieManager", False))
    cookie_config = payload.get("cookieConfig") or {}
    enable_cache_manager = bool(payload.get("enableCacheManager", False))
    cache_config = payload.get("cacheConfig") or {}
    enable_udv = bool(payload.get("enableUserDefinedVariables", False))
    user_defined_variables = payload.get("userDefinedVariables") or []
    enable_csv = bool(payload.get("enableCsvConfig", False))
    csv_variables = payload.get("csvVariables") or ""
    enable_scheduling = bool(payload.get("enableScheduling", False))
    schedule = payload.get("schedule")

    cookie_clear_each_iteration = cookie_config.get("clearEachIteration", False) if isinstance(cookie_config, dict) else False
    cookie_user_cookies = (cookie_config.get("userCookies") or cookie_config.get("cookies", [])) if isinstance(cookie_config, dict) else []
    cache_clear_each_iteration = cache_config.get("clearEachIteration", False) if isinstance(cache_config, dict) else False
    cache_max_size = int(cache_config.get("maxSize", 5000)) if isinstance(cache_config, dict) else 5000

    preview_path = generate_k6_script(
        test_name="__preview__",
        users=users,
        duration=duration,
        ramp_up=ramp_up,
        loop_count=loop_count,
        scenario=scenario,
        assertions=assertions,
        csv_enabled=enable_csv,
        csv_path=None,
        csv_variables=csv_variables,
        cookie_enabled=enable_cookie_manager,
        cookie_clear_each_iteration=cookie_clear_each_iteration,
        cache_enabled=enable_cache_manager,
        cache_clear_each_iteration=cache_clear_each_iteration,
        cache_max_size=cache_max_size,
        user_defined_variables=user_defined_variables if enable_udv else [],
        schedule_enabled=enable_scheduling,
        schedule=schedule,
        cookie_user_cookies=cookie_user_cookies if enable_cookie_manager else [],
    )

    script_content = ""
    if os.path.exists(preview_path):
        with open(preview_path, "r", encoding="utf-8") as f:
            script_content = f.read()
        try:
            os.remove(preview_path)
        except Exception:
            pass

    return {"script": script_content}


# ── NEW: Swagger / OpenAPI import — Step 1: discover ──────────────────────────
# Called by the "Import from Swagger" tab's "Discover APIs" button.
# Body: { "swagger_url": "https://petstore.swagger.io/v2/swagger.json" }
# Response shape matches what the frontend checks: res.data.success
@app.post("/discover-apis")
def discover_apis(
    payload: dict,
    current_user: AuthenticatedUser,
):
    swagger_url = (payload.get("swagger_url") or "").strip()
    if not swagger_url:
        raise HTTPException(status_code=400, detail="swagger_url is required")
 
    result = discover_apis_from_swagger(swagger_url)
 
    if "error" in result:
        # success: False — frontend shows swaggerError instead of the list
        return {"success": False, "error": result["error"]}
 
    return {
        "success":  True,
        "apis":     result["apis"],
        "base_url": result["base_url"],
        "count":    result["count"],
    }
 
 
# ── NEW: Swagger / OpenAPI import — Step 2: import selected APIs ─────────────
# Called by the "Import ... selected requests" button after the user has
# ticked which discovered operations they want. Body: { "apis": [ {...} ] }
# (each item is one of the objects returned by /discover-apis above).
@app.post("/import-apis")
def import_apis(
    payload: dict,
    current_user: AuthenticatedUser,
):
    apis = payload.get("apis") or []
    if not isinstance(apis, list) or not apis:
        raise HTTPException(status_code=400, detail="apis list is required")
 
    steps = []
    for api in apis:
        base_url = (api.get("base_url") or "").rstrip("/")
        path     = api.get("path") or ""
        url      = api.get("full_url") or f"{base_url}{path}"
 
        # Swagger path params look like /pet/{petId}. Convert to {{petId}} —
        # the same {{var}} template syntax generate_k6_script()'s
        # replace_vars() already substitutes in step URLs, so no changes are
        # needed in k6_runner.py for these steps to work.
        for p in (api.get("parameters") or []):
            if p.get("in") == "path" and p.get("name"):
                name = p["name"]
                url = url.replace("{%s}" % name, "{{%s}}" % name)
 
        steps.append({
            "id":              None,  # frontend assigns a fresh client id
            "name":            api.get("operationId") or api.get("summary") or f"{api.get('method', 'GET')} {path}",
            "method":          (api.get("method") or "GET").upper(),
            "url":             url,
            "body":            "",
            "headers":         "{}",
            "extractVariable": False,
            "variableName":    "",
            "jsonPath":        "",
        })
 
    return {"success": True, "steps": steps, "count": len(steps)}


@app.get("/dashboard-stats")
def dashboard_stats(db: DatabaseSession, current_user: AuthenticatedUser):
    total_tests = db.query(Test).filter(Test.user_id == current_user.id).count()

    base_q = (
        db.query(TestRun)
        .join(Test, Test.id == TestRun.test_id)
        .filter(Test.user_id == current_user.id)
    )
    total_runs     = base_q.distinct(TestRun.id).count()
    successful_runs = base_q.filter(TestRun.status == "completed").count()
    failed_runs    = base_q.filter(TestRun.status == "failed").count()
    running_runs   = base_q.filter(TestRun.status == "running").count()

    success_rate = round((successful_runs / total_runs) * 100, 2) if total_runs > 0 else 0

    return {
        "total_tests":   total_tests,
        "total_runs":    total_runs,
        "success_rate":  success_rate,
        "running_runs":  running_runs,
        "failed_runs":   failed_runs,
    }
    
@app.get("/test/{test_id}")
def get_test_by_id(
    test_id: int,
    db: DatabaseSession,
    current_user: AuthenticatedUser,
):
    test = db.query(Test).filter(Test.id == test_id, Test.user_id == current_user.id).first()
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    return test


@app.get("/recent-tests")
def recent_tests(db: DatabaseSession, current_user: AuthenticatedUser):
    return (
        db.query(Test)
        .filter(Test.user_id == current_user.id)
        .order_by(Test.id.desc())
        .limit(5)
        .all()
    )


@app.get("/execution-chart")
def execution_chart(db: DatabaseSession):
    runs = db.query(TestRun).order_by(TestRun.id).all()
    completed = failed = 0
    data = []
    for run in runs:
        if run.status == "completed":
            completed += 1
        elif run.status == "failed":
            failed += 1
        data.append({"run_id": run.id, "completed": completed, "failed": failed})
    return data


@app.delete("/delete-run/{run_id}")
def delete_run(run_id: int, db: DatabaseSession):
    run = db.query(TestRun).filter(TestRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    db.delete(run)
    db.commit()
    return {"message": "Run deleted successfully"}


from fastapi.responses import FileResponse, HTMLResponse

@app.get("/download-report/{run_id}")
def download_report(run_id: int, db: DatabaseSession):
    report = db.query(Report).filter(Report.execution_id == run_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if not os.path.exists(report.report_path):
        raise HTTPException(status_code=404, detail="Report file not found on disk")
    return FileResponse(
        path=report.report_path,
        media_type="application/pdf",
        filename=f"run_{run_id}_report.pdf",
    )


# ── Telemetry Health endpoint ───────────────────────────────────────────────

@app.get("/dashboard-report/{run_id}")
def get_dashboard_report(
    run_id: int,
    db: Annotated[Session, Depends(get_db)],
):
    """
    Serves the standalone k6 Web Dashboard HTML report or builds an interactive
    HTML report from summary.json / database. Zero 500 errors.
    """
    try:
        html_path = os.path.abspath(f"reports/{run_id}_dashboard.html")
        if os.path.exists(html_path):
            return FileResponse(
                path=html_path,
                media_type="text/html",
                headers={"X-Frame-Options": "SAMEORIGIN", "Cache-Control": "no-cache"},
            )

        # Look for summary.json or DB Report
        summary_path = os.path.abspath(f"reports/{run_id}_summary.json")
        summary_metrics = {}
        if os.path.exists(summary_path):
            try:
                with open(summary_path, "r", encoding="utf-8") as f:
                    summary_metrics = json.load(f).get("metrics", {})
            except Exception:
                pass

        run = db.query(TestRun).filter(TestRun.id == run_id).first()
        test = db.query(Test).filter(Test.id == run.test_id).first() if run else None
        test_name = test.test_name if test else f"Test #{run_id}"
        status = run.status.upper() if run else "COMPLETED"
        is_success = status in ("COMPLETED", "PASSED")

        # Metric values
        rps = round(summary_metrics.get("http_reqs", {}).get("rate", 0.0), 2)
        total_reqs = summary_metrics.get("http_reqs", {}).get("count", 0)
        dur = summary_metrics.get("http_req_duration", {})
        avg_rt = round(dur.get("avg", 0.0), 2)
        p90 = round(dur.get(P90_METRIC, 0.0), 2)
        p95 = round(dur.get(P95_METRIC, 0.0), 2)
        min_rt = round(dur.get("min", 0.0), 2)
        max_rt = round(dur.get("max", 0.0), 2)
        med_rt = round(dur.get("med", 0.0), 2)

        checks = summary_metrics.get("checks", {})
        passed_checks = checks.get("passes", 0)
        failed_checks = checks.get("fails", 0)
        check_rate = round(checks.get("value", 1.0) * 100, 1)

        err_rate = round(summary_metrics.get("http_req_failed", {}).get("rate", 0.0) * 100, 2)
        max_vus = summary_metrics.get("vus_max", {}).get("value", test.users if test else 1)

        status_color = "#22c55e" if is_success else "#ef4444"
        status_bg = "rgba(34, 197, 94, 0.15)" if is_success else "rgba(239, 68, 68, 0.15)"

        report_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>k6 Performance Report — Run #{run_id}</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      background: #090d16; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 32px 24px; line-height: 1.5;
    }}
    .container {{ max-width: 1040px; margin: 0 auto; }}
    .header {{
      display: flex; justify-content: space-between; align-items: flex-start;
      border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 24px; margin-bottom: 28px;
    }}
    .title-row {{ display: flex; align-items: center; gap: 12px; }}
    h1 {{ font-size: 24px; font-weight: 700; color: #f8fafc; letter-spacing: -0.5px; }}
    .status-badge {{
      display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 11px; font-weight: 700;
      background: {status_bg}; color: {status_color}; border: 1px solid {status_color}40; letter-spacing: 0.05em;
    }}
    .sub {{ font-size: 13px; color: #94a3b8; margin-top: 4px; }}
    .btn-group {{ display: flex; gap: 10px; }}
    .btn {{
      padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; text-decoration: none;
      cursor: pointer; display: inline-flex; align-items: center; gap: 6px; border: 1px solid transparent;
    }}
    .btn-primary {{ background: #4f46e5; color: #ffffff; }}
    .btn-outline {{ background: rgba(255,255,255,0.05); color: #94a3b8; border-color: rgba(255,255,255,0.12); }}
    .btn-outline:hover {{ color: #ffffff; border-color: #6366f1; }}

    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 28px; }}
    .card {{
      background: #111827; border: 1px solid rgba(255,255,255,0.07); border-radius: 12px;
      padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.25);
    }}
    .card-label {{ font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; font-weight: 600; }}
    .card-val {{ font-size: 28px; font-weight: 700; color: #f8fafc; margin: 8px 0 4px; font-family: monospace; }}
    .card-sub {{ font-size: 12px; color: #94a3b8; }}

    .section-title {{ font-size: 16px; font-weight: 700; color: #f8fafc; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }}
    .chart-box {{
      background: #111827; border: 1px solid rgba(255,255,255,0.07); border-radius: 12px; padding: 24px; margin-bottom: 28px;
    }}
    .bar-row {{ display: flex; align-items: center; gap: 16px; margin-bottom: 12px; font-size: 12px; }}
    .bar-label {{ width: 70px; color: #94a3b8; font-weight: 500; text-align: right; }}
    .bar-track {{ flex: 1; height: 16px; background: rgba(255,255,255,0.04); border-radius: 4px; overflow: hidden; }}
    .bar-fill {{ height: 100%; background: linear-gradient(90deg, #4f46e5, #6366f1); border-radius: 4px; }}
    .bar-val {{ width: 80px; font-family: monospace; color: #f8fafc; font-weight: 600; text-align: right; }}

    table {{ width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }}
    th {{ padding: 12px 14px; color: #64748b; font-size: 11px; text-transform: uppercase; border-bottom: 1px solid rgba(255,255,255,0.08); font-weight: 600; }}
    td {{ padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.04); color: #e2e8f0; }}
    tr:hover td {{ background: rgba(255,255,255,0.02); }}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <div class="title-row">
          <h1>{test_name}</h1>
          <span class="status-badge">{status}</span>
        </div>
        <p class="sub">Execution Run #{run_id} · Audited k6 Telemetry Report</p>
      </div>
      <div class="btn-group">
        <a class="btn btn-outline" href="http://localhost:8000/download-report/{run_id}" target="_blank">📄 Download PDF</a>
        <a class="btn btn-primary" href="http://localhost:5173/history">← Back to Portal</a>
      </div>
    </div>

    <!-- Metric KPI Grid -->
    <div class="grid">
      <div class="card">
        <div class="card-label">Throughput (RPS)</div>
        <div class="card-val" style="color:#38bdf8;">{rps} <span style="font-size:14px;color:#94a3b8;">req/s</span></div>
        <div class="card-sub">{total_reqs} total HTTP requests sent</div>
      </div>
      <div class="card">
        <div class="card-label">Avg Response Time</div>
        <div class="card-val" style="color:#818cf8;">{avg_rt} <span style="font-size:14px;color:#94a3b8;">ms</span></div>
        <div class="card-sub">Median: {med_rt}ms · Min: {min_rt}ms</div>
      </div>
      <div class="card">
        <div class="card-label">P95 Latency SLA</div>
        <div class="card-val" style="color:#a78bfa;">{p95} <span style="font-size:14px;color:#94a3b8;">ms</span></div>
        <div class="card-sub">P90 Percentile: {p90}ms · Max: {max_rt}ms</div>
      </div>
      <div class="card">
        <div class="card-label">Error Rate</div>
        <div class="card-val" style="color:{status_color};">{err_rate}%</div>
        <div class="card-sub">Target SLA: &lt; 1% failure rate</div>
      </div>
      <div class="card">
        <div class="card-label">Checks & Assertions</div>
        <div class="card-val" style="color:#34d399;">{check_rate}%</div>
        <div class="card-sub">{passed_checks} passed · {failed_checks} failed</div>
      </div>
      <div class="card">
        <div class="card-label">Peak Virtual Users</div>
        <div class="card-val" style="color:#fbbf24;">{max_vus} <span style="font-size:14px;color:#94a3b8;">VUs</span></div>
        <div class="card-sub">High concurrency load profile</div>
      </div>
    </div>

    <!-- Latency Percentiles Visualizer -->
    <div class="section-title">📊 Latency Percentile Distribution</div>
    <div class="chart-box">
      <div class="bar-row">
        <span class="bar-label">Min</span>
        <div class="bar-track"><div class="bar-fill" style="width: {min(100, max(6, int((min_rt / (max_rt or 1)) * 100)))}%;"></div></div>
        <span class="bar-val">{min_rt} ms</span>
      </div>
      <div class="bar-row">
        <span class="bar-label">Median</span>
        <div class="bar-track"><div class="bar-fill" style="width: {min(100, max(8, int((med_rt / (max_rt or 1)) * 100)))}%;"></div></div>
        <span class="bar-val">{med_rt} ms</span>
      </div>
      <div class="bar-row">
        <span class="bar-label">Average</span>
        <div class="bar-track"><div class="bar-fill" style="width: {min(100, max(10, int((avg_rt / (max_rt or 1)) * 100)))}%;"></div></div>
        <span class="bar-val">{avg_rt} ms</span>
      </div>
      <div class="bar-row">
        <span class="bar-label">P90</span>
        <div class="bar-track"><div class="bar-fill" style="width: {min(100, max(12, int((p90 / (max_rt or 1)) * 100)))}%; background: linear-gradient(90deg, #6366f1, #a855f7);"></div></div>
        <span class="bar-val">{p90} ms</span>
      </div>
      <div class="bar-row">
        <span class="bar-label">P95</span>
        <div class="bar-track"><div class="bar-fill" style="width: {min(100, max(14, int((p95 / (max_rt or 1)) * 100)))}%; background: linear-gradient(90deg, #a855f7, #ec4899);"></div></div>
        <span class="bar-val">{p95} ms</span>
      </div>
      <div class="bar-row">
        <span class="bar-label">Max</span>
        <div class="bar-track"><div class="bar-fill" style="width: 100%; background: linear-gradient(90deg, #ec4899, #f43f5e);"></div></div>
        <span class="bar-val">{max_rt} ms</span>
      </div>
    </div>

    <!-- Summary Metrics Table -->
    <div class="section-title">📋 Protocol & Execution Diagnostics</div>
    <div class="chart-box" style="padding: 12px 16px;">
      <table>
        <thead>
          <tr>
            <th>Metric Key</th>
            <th>Sample Count</th>
            <th>Throughput / Rate</th>
            <th>Value Breakdown</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>http_reqs</strong> (HTTP Requests)</td>
            <td>{total_reqs}</td>
            <td>{rps} req/sec</td>
            <td>HTTP transactions executed across scenario</td>
          </tr>
          <tr>
            <td><strong>http_req_duration</strong> (Latency)</td>
            <td>{total_reqs}</td>
            <td>avg: {avg_rt}ms</td>
            <td>min: {min_rt}ms · med: {med_rt}ms · max: {max_rt}ms</td>
          </tr>
          <tr>
            <td><strong>checks</strong> (SLA Assertions)</td>
            <td>{passed_checks + failed_checks}</td>
            <td>{check_rate}% success</td>
            <td>✓ {passed_checks} passed · ✗ {failed_checks} failed</td>
          </tr>
          <tr>
            <td><strong>vus</strong> (Concurrency)</td>
            <td>{max_vus} max</td>
            <td>—</td>
            <td>Concurrent virtual users executed in cluster</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>"""
        return HTMLResponse(content=report_html, status_code=200)

    except Exception:
        # Fallback safe error page (Zero 500 crashes)
        err_html = f"""<!DOCTYPE html>
<html>
<head><title>Run #{run_id} Report</title></head>
<body style="background:#090d16;color:#f8fafc;font-family:sans-serif;padding:40px;text-align:center;">
  <h2>Run #{run_id} Diagnostic Report</h2>
  <p style="color:#94a3b8;">Detailed summary is being processed or test run is in progress.</p>
  <a href="http://localhost:5173/history" style="color:#818cf8;text-decoration:none;font-weight:600;">← Return to Execution History</a>
</body>
</html>"""
        return HTMLResponse(content=err_html, status_code=200)


@app.get("/telemetry-status")
def telemetry_status():
    """
    Checks whether Grafana (port 3000), InfluxDB (port 8086), and k6 Web Dashboard (port 5665) are reachable.
    """
    k6_dashboard_online = _local_service_is_online(
        5665, "/", (200, 301, 302), timeout=0.6
    )
    grafana_online = _local_service_is_online(
        3000, "/api/health", (200,), timeout=0.8
    )
    influxdb_online = _local_service_is_online(
        8086, "/ping", (200, 204), timeout=0.8
    )

    return {
        "grafana_online": grafana_online,
        "influxdb_online": influxdb_online,
        "k6_dashboard_online": k6_dashboard_online,
        "k6_web_dashboard_url": "http://localhost:5665",
        "grafana_base_url": "http://localhost:3000",
        "grafana_dashboard_path": "/d/adfqsh7/k6-load-testing-results",
    }


def _local_service_is_online(
    port: int,
    path: str,
    expected_statuses: tuple[int, ...],
    timeout: float,
) -> bool:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    try:
        connection.request("GET", path, headers={"User-Agent": "k6-portal"})
        return connection.getresponse().status in expected_statuses
    except (OSError, http.client.HTTPException):
        return False
    finally:
        connection.close()


# ── APScheduler helper ────────────────────────────────────────────────────────

def run_scheduled_test(test_id: int):
    """
    Called by APScheduler at the scheduled time.
    Opens its own DB session and kicks off k6 in a daemon thread
    so the scheduler thread is never blocked.
    """
    db = SessionLocal()
    try:
        test = db.query(Test).filter(Test.id == test_id).first()
        if not test:
            print(f"[scheduler] Test {test_id} not found, skipping")
            return

        if not test.script_path or not os.path.exists(test.script_path):
            print(f"[scheduler] Script not found for test {test_id}, marking failed")
            test.status = "failed"
            db.commit()
            return

        test.status = "running"
        test_run = TestRun(
            test_id=test.id,
            user_id=test.user_id,
            status="running",
            output="",
        )
        db.add(test_run)
        db.commit()
        db.refresh(test_run)

        run_id         = test_run.id
        script_path    = test.script_path
        assertions_raw = test.assertions

        print(f"[scheduler] Firing test {test_id} → run {run_id}")

        t = threading.Thread(
            target=run_k6_in_background,
            args=(test_id, run_id, script_path, assertions_raw),
            daemon=True,
        )
        t.start()

    except Exception as e:
        print(f"[scheduler] Error launching test {test_id}: {e}")
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()
