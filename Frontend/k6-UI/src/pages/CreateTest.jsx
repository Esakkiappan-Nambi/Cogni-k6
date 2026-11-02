import { useNavigate, useParams } from "react-router-dom";
import React, { useState, useEffect, useRef } from "react";
import { GripVertical, Clock, Globe, Zap, Edit3, Info, Play, ChevronDown, ChevronUp, Search, Link2, Loader2, AlertCircle, Activity, Plus as PlusIcon } from "lucide-react";
import API from "../services/api";
import { FilePlus, PlayCircle, ArrowLeft, Plus, Trash2, Copy, KeyRound, Shield, Lock, User, Eye, EyeOff, CheckCircle } from "lucide-react";
import { toast } from "react-toastify";
import "./CreateTest.css";
import Layout from "../components/Layout";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext,verticalListSortingStrategy,arrayMove,useSortable,} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function SortableStep({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, listeners })}
    </div>
  );
}

// ── JSON Path Finder ─────────────────────────────────────────────────────────
// Renders a JSON value as an expandable, clickable tree. Every leaf value is a
// button — clicking it hands back the exact "$.a.b[0].c" style path needed for
// the step's "JSON Path" field, so users can *find* the path instead of guessing
// it. `searchTerm` highlights any key or value (case-insensitive) that matches.
function JsonPathExplorer({ data, onSelectPath, searchTerm }) {
  const term = (searchTerm || "").trim().toLowerCase();

  const renderNode = (value, path, keyLabel, depth) => {

    const isObj = value !== null && typeof value === "object";

    const keyMatches = term && keyLabel !== null && String(keyLabel).toLowerCase().includes(term);

    if (isObj) {
      const isArray = Array.isArray(value);

      const entries = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
      return (
        <div key={path || "root"} className="json-node" style={{ marginLeft: depth ? 14 : 0 }}>

          <div className={`json-node-key${keyMatches ? " json-match" : ""}`}>

            {keyLabel !== null && <span className="json-key-label">{String(keyLabel)}: </span>}
            <span className="json-bracket">{isArray ? "[" : "{"}</span>
            {entries.length === 0 && <span className="json-bracket">{isArray ? "]" : "}"}</span>}

          </div>

          {entries.map(([k, v]) =>
            renderNode(v, isArray ? `${path}[${k}]` : path ? `${path}.${k}` : String(k), isArray ? null : k, depth + 1)
          )}
          {entries.length > 0 && (

            <div className="json-bracket" style={{ marginLeft: (depth + 1) * 14 }}>

              {isArray ? "]" : "}"}

            </div>
          )}
        </div>
      );
    }

    const display = typeof value === "string" ? `"${value}"` : String(value);

    const valueMatches = term && display.toLowerCase().includes(term);

    const isMatch = keyMatches || valueMatches;

    return (
      <div key={path} className={`json-leaf${isMatch ? " json-match" : ""}`} style={{ marginLeft: depth * 14 }}>

        {keyLabel !== null && <span className="json-key-label">{String(keyLabel)}: </span>}
        <button type="button" className="json-value-btn" title={`Click to use this as the JSON Path: $.${path}`}
          onClick={() => onSelectPath(path)} >
          {display}
        </button>
        <span className="json-path-hint">$.{path}</span>
      </div>
    );
  };

  return <div className="json-tree">{renderNode(data, "", null, 0)}</div>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const defaultUDV = () => ({
  id: Date.now() + Math.random(),
  name: "",
  value: "",
  description: "",
  enabled: true,
});

const defaultRetry = () => ({
  enabled: false,
  maxRetries: 3,
  retryDelay: 1000,
  retryOn: [500, 502, 503],
  retryOnTimeout: true,
});

const defaultSchedule = () => ({
  startTime: "",
  frequency: "once",
  endTime: "",
});

// Resolve a "$.data.token" / "data.items[0].id" style path against a parsed
// JSON object — used to preview exactly what a step's jsonPath will extract,
// before the real k6 test ever runs.
const resolveJsonPath = (obj, path) => {
  if (!path || obj === undefined || obj === null) return undefined;
  const clean = path.trim().replace(/^\$\.?/, "");
  if (!clean) return obj;
  const parts = clean.split(".").filter(Boolean);
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    const arrayMatch = part.match(/^([^\[\]]+)((?:\[\d+\])*)$/);
    if (!arrayMatch) return undefined;
    const [, key, indexChain] = arrayMatch;
    if (key) current = current[key];
    if (indexChain) {
      const indices = [...indexChain.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
      for (const idx of indices) {
        if (current == null) return undefined;
        current = current[idx];
      }
    }
  }
  return current;
};

// ─────────────────────────────────────────────────────────────────────────────

function CreateTest() {
  const [mode, setMode] = useState("manual");

  // ── Auto Capture state ────────────────────────────────────────────────────
  const [captureUrl, setCaptureUrl]         = useState("");

  const [captureLoading, setCaptureLoading] = useState(false);

  const [capturedScenario, setCapturedScenario] = useState([]);
  const [captureError, setCaptureError]     = useState("");

  // ── Authenticated Capture state ───────────────────────────────────────────
  const [captureAuthMode, setCaptureAuthMode]           = useState("public"); // "public" | "auth"
  const [authLoginUrl, setAuthLoginUrl]                 = useState("");
  const [authUsername, setAuthUsername]                 = useState("");
  const [authPassword, setAuthPassword]                 = useState("");
  const [authShowPassword, setAuthShowPassword]         = useState(false);
  const [authAppUrl, setAuthAppUrl]                     = useState("");
  const [authUsernameSelector, setAuthUsernameSelector] = useState("");
  const [authPasswordSelector, setAuthPasswordSelector] = useState("");
  const [authSubmitSelector, setAuthSubmitSelector]     = useState("");
  const [authSuccessUrl, setAuthSuccessUrl]             = useState("");
  const [authLoginTimeout, setAuthLoginTimeout]         = useState(15000);
  const [authShowAdvanced, setAuthShowAdvanced]         = useState(false);
  const [authCaptureMeta, setAuthCaptureMeta]           = useState(null);
  
  const [captureOpts, setCaptureOpts]       = useState({
    wait_ms: 6000,
    interact: false,
    dedupe: true,
    inject_auth: false,
  });

  // ── NEW: Swagger / OpenAPI import state ───────────────────────────────────
  // Mirrors the "Auto Capture" state above, but the source of steps is a
  // swagger.json / openapi.json URL instead of a live browser capture.
  const [swaggerUrl, setSwaggerUrl] = useState("");
  const [swaggerLoading, setSwaggerLoading] = useState(false);
  const [swaggerError, setSwaggerError] = useState("");
  const [discoveredApis, setDiscoveredApis] = useState([]); // [{method, path, summary, full_url, ...}]
  const [selectedApiIndexes, setSelectedApiIndexes] = useState(new Set());
  const [importingApis, setImportingApis] = useState(false);
  // ── Step Preview state (JMeter "View Results Tree" style) ────────────────
  // stepPreviews: { [stepId]: { loading, error, expanded, response, extractedValue, viewMode, searchTerm } }
  const [stepPreviews, setStepPreviews] = useState({});
  // previewVariables: variables captured so far while previewing steps,
  // e.g. { token: "abc123" } — clickable to insert into a later step.
  const [previewVariables, setPreviewVariables] = useState({});
  // Tracks the last focused url/headers/body field so a variable chip click
  // knows where to insert {{varName}}.
  const lastFocusedRef = useRef(null);

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over) return;
    if (active.id !== over.id) {
      setScenario((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const navigate = useNavigate();
  const { id } = useParams();

  const [formData, setFormData] = useState({
    testName: "",
    users: "",
    duration: "",
    rampUp: "",
    loopCount: "",
    enableUserDefinedVariables: false,
    userDefinedVariables: [],
    enableCsvConfig: false,
    enableCookieManager: false,
    enableCacheManager: false,
    enableScheduling: false,
    schedule: defaultSchedule(),
    cacheConfig: { clearEachIteration: false, maxSize: 75 },
    csvConfig: { file: null, variable_name: "" },
    cookieConfig: { clearEachIteration: false, policy: "strict" },
    enableAssertions: false,
    assertions: { status_code: 200, max_response_time: 500, max_error_rate: 1 },
  });

  const defaultStep = () => ({
    id: Date.now(),
    name: `Request 1`,
    method: "GET",
    url: "",
    body: "",
    headers: "",
    enabled: true,
    thinkTime: "",
    extractVariable: false,
    variableName: "",
    jsonPath: "",
    params: [],
    assertions: {
      enabled: false,
      status_code: "",
      max_response_time: "",
      max_error_rate: "",
      text_assertions: [],
    },
    retry: defaultRetry(),
  });

  const [scenario, setScenario] = useState([defaultStep()]);

  useEffect(() => {
    if (id) loadTestData();
  }, [id]);

  // Load steps imported from the HTTP Recorder
  useEffect(() => {
    const imported = sessionStorage.getItem("recorder_import");
    if (imported && !id) {
      try {
        const steps = JSON.parse(imported);
        setScenario(steps);
        setMode("manual");
        sessionStorage.removeItem("recorder_import");
        toast.success(`${steps.length} request(s) imported from HTTP Recorder`);
      } catch { /* ignore */ }
    }
  }, []);

  const loadTestData = async () => {
    try {
      const res = await API.get(`/test/${id}`);
      const test = res.data;
      let parsedSchedule = defaultSchedule();
      if (test.schedule) {
        try { parsedSchedule = { ...defaultSchedule(), ...JSON.parse(test.schedule) }; }
        catch { parsedSchedule = defaultSchedule(); }
      }
      setFormData({
        testName: test.test_name,
        users: test.users,
        duration: test.duration,
        rampUp: test.ramp_up,
        loopCount: test.loop_count,
        enableAssertions: !!test.assertions,
        enableCsvConfig: !!test.csv_enabled,
        enableCookieManager: !!test.cookie_enabled,
        enableCacheManager: !!test.cache_enabled,
        enableUserDefinedVariables: !!test.udv_enabled,
        enableScheduling: !!test.schedule_enabled,
        schedule: parsedSchedule,
        userDefinedVariables: test.user_defined_variables ? JSON.parse(test.user_defined_variables) : [],
        cacheConfig: { clearEachIteration: !!test.cache_clear_each_iteration, maxSize: test.cache_max_size || 75 },
        assertions: test.assertions ? JSON.parse(test.assertions) : { status_code: 200, max_response_time: 500, max_error_rate: 1 },
        csvConfig: { file: null, variable_name: test.csv_variables || "" },
        cookieConfig: { clearEachIteration: !!test.cookie_clear_each_iteration, policy: test.cookie_policy || "strict" },
      });
      const loadedScenario = test.scenario ? JSON.parse(test.scenario) : [];
      setScenario(loadedScenario.map((step) => ({
        ...step,
        assertions: { ...step.assertions, text_assertions: step.assertions?.text_assertions || [] },
        retry: step.retry ?? defaultRetry(),
      })));
    } catch (error) {
      console.error(error);
      toast.error("Failed to load test!");
    }
  };

  // ── Auto Capture handlers ─────────────────────────────────────────────────

  const handleCapture = async () => {
    if (captureAuthMode === "public") {
      if (!captureUrl.trim()) {
        toast.error("Please enter a URL to capture");
        return;
      }
      setCaptureLoading(true);
      setCaptureError("");
      setCapturedScenario([]);
      setAuthCaptureMeta(null);

      try {
        const res = await API.post("/auto-capture", {
          url: captureUrl.trim(),
          ...captureOpts,
        });
        setCapturedScenario(res.data.scenario);
        toast.success(`Captured ${res.data.count} API call(s) from ${captureUrl}`);
      } catch (err) {
        const msg = err.response?.data?.detail || "Capture failed. Check the URL and try again.";
        setCaptureError(msg);
        toast.error(msg);
      } finally {
        setCaptureLoading(false);
      }
    } else {
      // Authenticated capture
      if (!authLoginUrl.trim()) {
        toast.error("Please enter the login page URL");
        return;
      }
      if (!authUsername.trim() || !authPassword.trim()) {
        toast.error("Please provide both username and password");
        return;
      }
      setCaptureLoading(true);
      setCaptureError("");
      setCapturedScenario([]);
      setAuthCaptureMeta(null);

      try {
        const postAppUrls = authAppUrl.trim()
          ? authAppUrl.split(",").map((u) => u.trim()).filter(Boolean)
          : [authLoginUrl.trim()];

        const res = await API.post("/authenticated-capture", {
          login_url: authLoginUrl.trim(),
          username: authUsername.trim(),
          password: authPassword.trim(),
          app_url: postAppUrls,
          username_selector: authUsernameSelector.trim() || null,
          password_selector: authPasswordSelector.trim() || null,
          submit_selector: authSubmitSelector.trim() || null,
          success_url_contains: authSuccessUrl.trim() || null,
          login_timeout_ms: authLoginTimeout || 15000,
          wait_ms: captureOpts.wait_ms || 8000,
          interact: captureOpts.interact,
          dedupe: captureOpts.dedupe,
          inject_auth: captureOpts.inject_auth,
        });

        setCapturedScenario(res.data.scenario);
        setAuthCaptureMeta({
          login_success: res.data.login_success,
          token_found: res.data.token_found,
          cookies_count: res.data.cookies_count,
          message: res.data.message,
        });
        toast.success(`Authenticated capture: ${res.data.count} API call(s) captured!`);
      } catch (err) {
        const msg = err.response?.data?.detail || "Authenticated capture failed. Verify credentials and selectors.";
        setCaptureError(msg);
        toast.error(msg);
      } finally {
        setCaptureLoading(false);
      }
    }
  };

  const toggleCapturedStep = (index) => {
    setCapturedScenario((prev) =>
      prev.map((s, i) => (i === index ? { ...s, enabled: !s.enabled } : s))
    );
  };

  const handleImportScenario = () => {
    const enabled = capturedScenario.filter((s) => s.enabled);
    if (enabled.length === 0) {
      toast.error("No steps selected. Enable at least one step.");
      return;
    }
    const normalised = enabled.map((s, i) => ({
      id: Date.now() + i,
      name: s.name || `Request ${i + 1}`,
      method: s.method || "GET",
      url: s.url || "",
      body: s.body ? JSON.stringify(s.body) : "",
      headers: s.headers ? JSON.stringify(s.headers) : "",
      enabled: true,
      thinkTime: "",
      extractVariable: !!s.extractVariable,
      variableName: s.variableName || "",
      jsonPath: s.jsonPath || "",
      params: [],
      assertions: {
        enabled: false,
        status_code: 200,
        max_response_time: 2000,
        max_error_rate: 1,
        text_assertions: [],
      },
      retry: defaultRetry(),
    }));
    setScenario(normalised);
    setMode("manual");
    toast.success(`${normalised.length} step(s) imported into scenario builder`);
  };

  // ── NEW: Swagger / OpenAPI import handlers ────────────────────────────────
  // Same shape as the Auto Capture handlers above: discover -> select ->
  // import into the manual scenario builder.
  const discoverApis = async () => {
    if (!swaggerUrl.trim()) {
      toast.error("Please enter a Swagger / OpenAPI URL");
      return;
    }
    setSwaggerLoading(true);
    setSwaggerError("");
    setDiscoveredApis([]);
    setSelectedApiIndexes(new Set());

    try {
      const res = await API.post("/discover-apis", { swagger_url: swaggerUrl.trim() });

      if (!res.data?.success) {
        setSwaggerError(res.data?.error || "Could not read APIs from that URL.");
        return;
      }

      const apis = res.data.apis || [];
      setDiscoveredApis(apis);
      // Select all by default — easier to deselect a few than to select many
      setSelectedApiIndexes(new Set(apis.map((_, i) => i)));
      toast.success(`Found ${apis.length} API(s) at ${swaggerUrl}`);
    } catch (err) {
      const msg = err.response?.data?.detail || "Request to discover APIs failed.";
      setSwaggerError(msg);
      toast.error(msg);
    } finally {
      setSwaggerLoading(false);
    }
  };

  const toggleApiSelection = (index) => {
    setSelectedApiIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const importSelectedApis = async () => {
    const apisToImport = discoveredApis.filter((_, i) => selectedApiIndexes.has(i));
    if (apisToImport.length === 0) return;

    setImportingApis(true);
    try {
      const res = await API.post("/import-apis", { apis: apisToImport });

      if (!res.data?.success) {
        toast.error("Could not import the selected APIs.");
        return;
      }

      // Map each imported API into this builder's step shape (defaultStep) —
      // same idea as handleImportScenario() above, just from a different
      // source. Backend sends id: null on purpose, so a fresh client-side
      // id is assigned here.
      const newSteps = (res.data.steps || []).map((step, i) => ({
        id: Date.now() + i,
        name: step.name || `Request ${scenario.length + i + 1}`,
        method: step.method || "GET",
        url: step.url || "",
        body: step.body ? (typeof step.body === "string" ? step.body : JSON.stringify(step.body)) : "",
        headers: step.headers ? (typeof step.headers === "string" ? step.headers : JSON.stringify(step.headers)) : "",
        enabled: true,
        thinkTime: "",
        extractVariable: !!step.extractVariable,
        variableName: step.variableName || "",
        jsonPath: step.jsonPath || "",
        params: [],
        assertions: {
          enabled: false,
          status_code: 200,
          max_response_time: 2000,
          max_error_rate: 1,
          text_assertions: [],
        },
        retry: defaultRetry(),
      }));

      setScenario((prev) => [...prev, ...newSteps]);
      setMode("manual");

      // Reset the import panel after a successful import
      setDiscoveredApis([]);
      setSelectedApiIndexes(new Set());
      setSwaggerUrl("");

      toast.success(`Imported ${newSteps.length} request${newSteps.length === 1 ? "" : "s"} into the scenario.`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Import failed.");
    } finally {
      setImportingApis(false);
    }
  };

  // ── Form helpers ──────────────────────────────────────────────────────────

  const updateSchedule = (field, value) =>
    setFormData((prev) => ({ ...prev, schedule: { ...prev.schedule, [field]: value } }));

  const handleChange = (e) => {
    const { name, value, type, checked, files } = e.target;
    if (type === "checkbox") {
      setFormData({ ...formData, [name]: checked });
    } else if (["status_code", "max_response_time", "max_error_rate"].includes(name)) {
      setFormData({ ...formData, assertions: { ...formData.assertions, [name]: Number(value) } });
    } else if (name === "csv_file") {
      setFormData({ ...formData, csvConfig: { ...formData.csvConfig, file: files[0] } });
    } else if (name === "variable_name") {
      setFormData({ ...formData, csvConfig: { ...formData.csvConfig, variable_name: value } });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  // ── UDV helpers ───────────────────────────────────────────────────────────
  const addUDV = () => setFormData((prev) => ({ ...prev, userDefinedVariables: [...prev.userDefinedVariables, defaultUDV()] }));
  const updateUDV = (udvId, field, value) => setFormData((prev) => ({ ...prev, userDefinedVariables: prev.userDefinedVariables.map((v) => v.id === udvId ? { ...v, [field]: value } : v) }));
  const removeUDV = (udvId) => setFormData((prev) => ({ ...prev, userDefinedVariables: prev.userDefinedVariables.filter((v) => v.id !== udvId) }));
  const toggleAllUDV = (checked) => setFormData((prev) => ({ ...prev, userDefinedVariables: prev.userDefinedVariables.map((v) => ({ ...v, enabled: checked })) }));

  // ── Scenario helpers ──────────────────────────────────────────────────────
  const addScenarioStep = () => {
    setScenario([...scenario, {
      ...defaultStep(),
      id: Date.now(),
      name: `Request ${scenario.length + 1}`,
      assertions: { enabled: false, status_code: 200, max_response_time: 500, max_error_rate: 1, text_assertions: [] },
      retry: defaultRetry(),
    }]);
  };

  const duplicateStep = (stepId) => {
    const s = scenario.find((step) => step.id === stepId);
    if (!s) return;
    const dup = {
      ...s, id: Date.now(), name: `${s.name} (Copy)`,
      assertions: { ...s.assertions, text_assertions: (s.assertions?.text_assertions || []).map((ta) => ({ ...ta, id: Date.now() + Math.random() })) },
      params: (s.params || []).map((p) => ({ ...p, id: Date.now() + Math.random() })),
      retry: { ...(s.retry ?? defaultRetry()) },
    };
    const idx = scenario.findIndex((step) => step.id === stepId);
    const updated = [...scenario];
    updated.splice(idx + 1, 0, dup);
    setScenario(updated);
    toast.success(`Step "${s.name}" duplicated`);
  };

  const removeStep = (stepId) => {
    setScenario(scenario.filter((s) => s.id !== stepId));
    setStepPreviews((prev) => {
      const next = { ...prev };
      delete next[stepId];
      return next;
    });
  };
  const updateStep = (id, field, value) => setScenario(scenario.map((s) => s.id === id ? { ...s, [field]: value } : s));
  const updateStepAssertion = (id, field, value) => setScenario(scenario.map((s) => s.id === id ? { ...s, assertions: { ...s.assertions, [field]: value } } : s));

  const addTextAssertion = (stepId) => setScenario(scenario.map((s) => s.id === stepId ? { ...s, assertions: { ...s.assertions, text_assertions: [...(s.assertions.text_assertions || []), { id: Date.now() + Math.random(), field: "body", condition: "contains", value: "" }] } } : s));
  const updateTextAssertion = (stepId, taId, field, value) => setScenario(scenario.map((s) => s.id === stepId ? { ...s, assertions: { ...s.assertions, text_assertions: s.assertions.text_assertions.map((ta) => ta.id === taId ? { ...ta, [field]: value } : ta) } } : s));
  const removeTextAssertion = (stepId, taId) => setScenario(scenario.map((s) => s.id === stepId ? { ...s, assertions: { ...s.assertions, text_assertions: s.assertions.text_assertions.filter((ta) => ta.id !== taId) } } : s));

  const addParam = (stepId) => setScenario(scenario.map((s) => s.id === stepId ? { ...s, params: [...(s.params || []), { id: Date.now() + Math.random(), name: "", value: "", enabled: true }] } : s));
  const updateParam = (stepId, paramId, field, value) => setScenario(scenario.map((s) => s.id === stepId ? { ...s, params: s.params.map((p) => p.id === paramId ? { ...p, [field]: value } : p) } : s));
  const removeParam = (stepId, paramId) => setScenario(scenario.map((s) => s.id === stepId ? { ...s, params: s.params.filter((p) => p.id !== paramId) } : s));

  const updateRetry = (stepId, field, value) => setScenario(scenario.map((s) => s.id === stepId ? { ...s, retry: { ...s.retry, [field]: value } } : s));
  const toggleRetryCode = (stepId, code) => setScenario(scenario.map((s) => {
    if (s.id !== stepId) return s;
    const codes = s.retry.retryOn.includes(code) ? s.retry.retryOn.filter((c) => c !== code) : [...s.retry.retryOn, code];
    return { ...s, retry: { ...s.retry, retryOn: codes } };
  }));
  const addCustomRetryCode = (stepId, rawValue) => {
    const code = parseInt(rawValue, 10);
    if (isNaN(code) || code < 100 || code > 599) { toast.error("Enter a valid HTTP status code (100–599)"); return false; }
    setScenario(scenario.map((s) => {
      if (s.id !== stepId || s.retry.retryOn.includes(code)) return s;
      return { ...s, retry: { ...s.retry, retryOn: [...s.retry.retryOn, code] } };
    }));
    return true;
  };
  const removeRetryCode = (stepId, code) => setScenario(scenario.map((s) => s.id !== stepId ? s : { ...s, retry: { ...s.retry, retryOn: s.retry.retryOn.filter((c) => c !== code) } }));

  // ── Step Preview / "Run & View JSON Response" (JMeter-style chaining) ─────

  // Replace any {{varName}} placeholder with a value captured from a previous preview
  const substitutePreviewVars = (text) => {
    if (!text) return text;
    let result = text;
    Object.entries(previewVariables).forEach(([key, value]) => {
      result = result.split(`{{${key}}}`).join(value);
    });
    return result;
  };

  const runStepPreview = async (step) => {
    if (!step.url.trim()) {
      toast.error("Enter a URL before running a preview");
      return;
    }
    setStepPreviews((prev) => ({
      ...prev,
      [step.id]: { ...(prev[step.id] || {}), loading: true, error: "", expanded: true },
    }));

    try {
      let headersObj = {};
      try {
        headersObj = step.headers ? JSON.parse(substitutePreviewVars(step.headers)) : {};
      } catch {
        headersObj = {};
      }

      let url = substitutePreviewVars(step.url);
      if (step.method === "GET" && step.params?.length) {
        const qs = step.params
          .filter((p) => p.enabled && p.name.trim())
          .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(substitutePreviewVars(p.value))}`)
          .join("&");
        if (qs) url += (url.includes("?") ? "&" : "?") + qs;
      }

      const bodyVal = step.method !== "GET" && step.body ? substitutePreviewVars(step.body) : "";

      const res = await API.post("/preview-step", {
        method: step.method,
        url,
        headers: headersObj,
        body: bodyVal,
      });
      const data = res.data;

      let extractedValue;
      if (step.extractVariable && step.variableName?.trim() && step.jsonPath?.trim() && data.body_json !== undefined && data.body_json !== null) {
        extractedValue = resolveJsonPath(data.body_json, step.jsonPath);
        if (extractedValue !== undefined) {
          const storedValue = typeof extractedValue === "string" ? extractedValue : JSON.stringify(extractedValue);
          setPreviewVariables((prev) => ({ ...prev, [step.variableName.trim()]: storedValue }));
          toast.success(`Extracted "${step.variableName}" — now available for later steps`);
        }
      }

      setStepPreviews((prev) => ({
        ...prev,
        [step.id]: {
          ...(prev[step.id] || {}),
          loading: false,
          error: "",
          expanded: true,
          response: data,
          extractedValue,
          viewMode: (prev[step.id] && prev[step.id].viewMode) || "tree",
        },
      }));
    } catch (err) {
      const msg = err.response?.data?.detail || "Preview request failed";
      setStepPreviews((prev) => ({
        ...prev,
        [step.id]: { ...(prev[step.id] || {}), loading: false, error: msg, expanded: true },
      }));
      toast.error(msg);
    }
  };

  const toggleStepPreview = (stepId) =>
    setStepPreviews((prev) => ({ ...prev, [stepId]: { ...(prev[stepId] || {}), expanded: !(prev[stepId]?.expanded) } }));

  // Switch between the clickable "Tree" explorer and the plain "Raw" JSON view.
  const setPreviewViewMode = (stepId, mode) =>
    setStepPreviews((prev) => ({ ...prev, [stepId]: { ...(prev[stepId] || {}), viewMode: mode } }));

  // Live search term used to highlight matching keys/values inside the tree view.
  const setPreviewSearch = (stepId, term) =>
    setStepPreviews((prev) => ({ ...prev, [stepId]: { ...(prev[stepId] || {}), searchTerm: term } }));

  // Called when the user clicks a value in the JSON tree — this *is* the "find
  // the path" feature: it fills in JSON Path + Variable Name for that step
  // automatically, using the exact path clicked in the response.
  const selectJsonPath = (stepId, path) => {
    const step = scenario.find((s) => s.id === stepId);
    if (!step) return;
    const segments = path.split(/[.[]/).filter(Boolean);
    const lastSegment = segments.length ? segments[segments.length - 1].replace("]", "") : "value";
    setScenario((prev) =>
      prev.map((s) =>
        s.id === stepId
          ? {
              ...s,
              extractVariable: true,
              jsonPath: `$.${path}`,
              variableName: s.variableName?.trim() ? s.variableName : lastSegment,
            }
          : s
      )
    );
    toast.success(`JSON Path set to $.${path}`);
  };

  const trackFocus = (stepId, field) => (e) => {
    lastFocusedRef.current = { stepId, field, el: e.target };
  };

  const insertVariableIntoField = (varName) => {
    const target = lastFocusedRef.current;
    if (!target) {
      toast.error(`Click into a URL, Headers, or Body field first, then click {{${varName}}}`);
      return;
    }
    const { stepId, field, el } = target;
    const step = scenario.find((s) => s.id === stepId);
    if (!step) return;

    const insertText = `{{${varName}}}`;
    const currentVal = step[field] || "";
    let newVal;
    if (el && typeof el.selectionStart === "number" && document.activeElement === el) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      newVal = currentVal.slice(0, start) + insertText + currentVal.slice(end);
    } else {
      newVal = currentVal + insertText;
    }
    updateStep(stepId, field, newVal);
    toast.success(`Inserted {{${varName}}} into ${field}`);
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.testName.trim()) { toast.error("Please enter a test name!"); return; }
    if (formData.enableScheduling) {
      if (!formData.schedule.startTime) { toast.error("Please set a Start Time for the schedule"); return; }
      if (formData.schedule.endTime && formData.schedule.endTime <= formData.schedule.startTime) { toast.error("End Time must be after Start Time"); return; }
    }
    if (formData.enableUserDefinedVariables) {
      for (let v of formData.userDefinedVariables.filter((v) => v.enabled)) {
        if (!v.name.trim()) { toast.error("Variable name is required for all enabled User Defined Variables"); return; }
      }
    }
    const enabledSteps = scenario.filter((s) => s.enabled);
    for (let step of enabledSteps) {
      if (!step.url.trim()) { toast.error(`URL missing in step: ${step.name}`); return; }
      if (step.extractVariable) {
        if (!step.variableName.trim()) { toast.error(`Enter variable name in step: ${step.name}`); return; }
        if (!step.jsonPath.trim()) { toast.error(`Enter JSON path in step: ${step.name}`); return; }
      }
      for (let ta of (step.assertions?.text_assertions || [])) {
        if (!ta.value.trim()) { toast.error(`Text assertion value is empty in step: ${step.name}`); return; }
      }
      if (step.retry?.enabled) {
        if (!step.retry.maxRetries || step.retry.maxRetries < 1) { toast.error(`Max retries must be at least 1 in step: ${step.name}`); return; }
        if (step.retry.retryDelay < 0) { toast.error(`Retry delay cannot be negative in step: ${step.name}`); return; }
      }
    }

    const payload = new FormData();
    payload.append("test_name", formData.testName);
    payload.append("users", Number(formData.users));
    payload.append("duration", Number(formData.duration));
    payload.append("ramp_up", Number(formData.rampUp));
    payload.append("loop_count", Number(formData.loopCount));
    payload.append("scenario", JSON.stringify(enabledSteps));
    payload.append("enable_cookie_manager", formData.enableCookieManager);
    payload.append("enable_cache_manager", formData.enableCacheManager);
    payload.append("enable_scheduling", formData.enableScheduling);
    if (formData.enableScheduling) payload.append("schedule", JSON.stringify(formData.schedule));
    payload.append("enable_udv", formData.enableUserDefinedVariables);
    if (formData.enableUserDefinedVariables) payload.append("user_defined_variables", JSON.stringify(formData.userDefinedVariables));
    if (formData.enableCacheManager) payload.append("cache_config", JSON.stringify(formData.cacheConfig));
    if (formData.enableAssertions) payload.append("assertions", JSON.stringify(formData.assertions));
    if (formData.enableCsvConfig) {
      payload.append("enable_csv", formData.enableCsvConfig);
      payload.append("variable_name", formData.csvConfig.variable_name);
      if (formData.csvConfig.file) payload.append("csv_file", formData.csvConfig.file);
    }
    if (formData.enableCookieManager) payload.append("cookie_config", JSON.stringify(formData.cookieConfig));

    try {
      if (id) {
        await API.put(`/update-test/${id}`, payload, { headers: { "Content-Type": "multipart/form-data" } });
        toast.success("Test updated successfully!");
      } else {
        await API.post("/create-test", payload, { headers: { "Content-Type": "multipart/form-data" } });
        toast.success("Test created successfully");
      }
      navigate("/run-test");
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.detail || "Error saving test");
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Layout>
    <div className="create-test-page">

      {/* ── PAGE HEADER (matches screenshot 2) ── */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-header-title">Scenario Studio</div>
          <div className="page-header-sub">Design virtual user transactions, assertions, and test pipelines</div>
        </div>
        <div className="page-header-right">
          <button className="btn btn-primary" onClick={() => navigate("/createtest")}>
            <Plus size={14} /> New Test
          </button>
          <div style={{ display:"flex",alignItems:"center",gap:8,background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"6px 14px",fontSize:13,color:"var(--tx2)" }}>
            <div style={{ width:8,height:8,borderRadius:"50%",background:"var(--brand)",flexShrink:0 }} />
            {localStorage.getItem("full_name") || "User"}
          </div>
        </div>
      </div>

      {/* ── Scenario Studio inner header ── */}
      <div style={{ background:"var(--bg3)",borderBottom:"1px solid var(--border)",padding:"16px 24px" }}>
        <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:8 }}>
          <Zap size={14} style={{ color:"var(--brand-l)" }} />
          <span style={{ fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--tx3)" }}>SCENARIO STUDIO</span>
        </div>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:14,flexWrap:"wrap" }}>
          <div style={{ fontSize:22,fontWeight:700,color:"var(--tx)" }}>
            {id ? "Edit Test Scenario" : "Performance Test Scenario"}
          </div>
          <div style={{ display:"flex",gap:8 }}>
            <button className="btn btn-ghost" onClick={() => navigate("/run-test")}>Cancel</button>
            <button className="btn btn-primary" form="ct-form" type="submit">
              <FilePlus size={14} /> Save & Proceed
            </button>
          </div>
        </div>
        {/* Summary bar */}
        <div className="ct-summary-bar" style={{ marginTop:12 }}>
          <span>Virtual Users: <strong>{formData.users || 0} VUs</strong></span>
          <span>Duration: <strong>{formData.duration || 0}s</strong></span>
          <span>Ramp-Up: <strong>{formData.rampUp || 0}s</strong></span>
          <span>Steps Count: <strong>{scenario.filter(s=>s.enabled).length} HTTP steps</strong></span>
        </div>
      </div>

      {/* ── Mode tabs (matches screenshot 2 tabs) ── */}
      <div className="ct-tabs" style={{ background:"var(--bg2)",padding:"0 24px" }}>
        <button type="button" className={`ct-tab${mode === "manual" ? " active" : ""}`} onClick={() => setMode("manual")}>
          <Globe size={14} /> HTTP Scenario Steps ({scenario.length})
        </button>
        <button type="button" className={`ct-tab${mode === "workload" ? " active" : ""}`} onClick={() => setMode("workload")}>
          <Activity size={14} /> Workload & Execution
        </button>
        <button type="button" className={`ct-tab${mode === "engine" ? " active" : ""}`} onClick={() => setMode("engine")}>
          <Zap size={14} /> Engine & Parameters
        </button>
        <button type="button" className={`ct-tab${mode === "auto" ? " active" : ""}`} onClick={() => setMode("auto")}>
          <Search size={14} /> Auto Capture
        </button>
        <button type="button" className={`ct-tab${mode === "swagger" ? " active" : ""}`} onClick={() => setMode("swagger")}>
          <Link2 size={14} /> Import Swagger
        </button>
      </div>

      {mode === "auto" && (
        <div className="create-form">
          {/* ── Mode selector: Public vs Authenticated ── */}
          <div className="cap-mode-selector">
            <button
              type="button"
              className={`cap-mode-pill ${captureAuthMode === "public" ? "active" : ""}`}
              onClick={() => { setCaptureAuthMode("public"); setCaptureError(""); }}
            >
              <Globe size={13} /> Public Application URL
            </button>
            <button
              type="button"
              className={`cap-mode-pill ${captureAuthMode === "auth" ? "active" : ""}`}
              onClick={() => { setCaptureAuthMode("auth"); setCaptureError(""); }}
            >
              <KeyRound size={13} /> Authenticated Application (Login Protected)
            </button>
          </div>

          {/* ── PUBLIC CAPTURE FORM ── */}
          {captureAuthMode === "public" && (
            <>
              <p className="section-label"><Globe size={13} /> Application URL</p>
              <div className="capture-url-row">
                <input
                  type="url"
                  className="capture-url-input"
                  placeholder="https://your-app.com"
                  value={captureUrl}
                  onChange={(e) => setCaptureUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCapture()}
                />
                <button
                  type="button"
                  className="capture-btn"
                  onClick={handleCapture}
                  disabled={captureLoading || !captureUrl.trim()}
                >
                  <Zap size={14} /> {captureLoading ? "Capturing…" : "Capture APIs"}
                </button>
              </div>
            </>
          )}

          {/* ── AUTHENTICATED CAPTURE FORM ── */}
          {captureAuthMode === "auth" && (
            <div className="auth-capture-box">
              <div className="auth-cap-row">
                <div className="auth-cap-field" style={{ flex: 1.2 }}>
                  <label className="auth-cap-label">
                    <Globe size={12} /> Login Page URL <span className="req-star">*</span>
                  </label>
                  <input
                    type="url"
                    className="capture-url-input"
                    placeholder="https://myapp.com/login"
                    value={authLoginUrl}
                    onChange={(e) => setAuthLoginUrl(e.target.value)}
                  />
                </div>
                <div className="auth-cap-field" style={{ flex: 1 }}>
                  <label className="auth-cap-label">
                    <User size={12} /> Username / Email <span className="req-star">*</span>
                  </label>
                  <input
                    type="text"
                    className="capture-url-input"
                    placeholder="admin@myapp.com"
                    value={authUsername}
                    onChange={(e) => setAuthUsername(e.target.value)}
                  />
                </div>
                <div className="auth-cap-field" style={{ flex: 1 }}>
                  <label className="auth-cap-label">
                    <Lock size={12} /> Password <span className="req-star">*</span>
                  </label>
                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <input
                      type={authShowPassword ? "text" : "password"}
                      className="capture-url-input"
                      style={{ paddingRight: 36 }}
                      placeholder="Enter password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setAuthShowPassword(!authShowPassword)}
                      style={{ position: "absolute", right: 8, background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: 4 }}
                    >
                      {authShowPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="auth-cap-row" style={{ marginTop: 12 }}>
                <div className="auth-cap-field" style={{ flex: 1 }}>
                  <label className="auth-cap-label">
                    <Zap size={12} /> Post-Login Target URL(s) to Capture
                    <span style={{ fontWeight: 400, color: "#94a3b8", marginLeft: 6 }}>(comma-separated if multiple)</span>
                  </label>
                  <input
                    type="text"
                    className="capture-url-input"
                    placeholder="https://myapp.com/dashboard, https://myapp.com/settings"
                    value={authAppUrl}
                    onChange={(e) => setAuthAppUrl(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button
                    type="button"
                    className="capture-btn"
                    onClick={handleCapture}
                    disabled={captureLoading || !authLoginUrl.trim() || !authUsername.trim() || !authPassword.trim()}
                  >
                    <KeyRound size={14} /> {captureLoading ? "Authenticating & Capturing…" : "Capture Authenticated APIs"}
                  </button>
                </div>
              </div>

              {/* Advanced login selectors accordion */}
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 11, color: "#818cf8", padding: "4px 8px" }}
                  onClick={() => setAuthShowAdvanced(!authShowAdvanced)}
                >
                  {authShowAdvanced ? "▲ Hide Custom Selectors" : "▼ Custom CSS Selectors & URL Match (Optional)"}
                </button>

                {authShowAdvanced && (
                  <div className="auth-advanced-grid">
                    <div className="auth-cap-field">
                      <label className="auth-cap-label">Username Field Selector</label>
                      <input
                        type="text"
                        className="capture-url-input"
                        placeholder="Auto-detected (or input[name=email])"
                        value={authUsernameSelector}
                        onChange={(e) => setAuthUsernameSelector(e.target.value)}
                      />
                    </div>
                    <div className="auth-cap-field">
                      <label className="auth-cap-label">Password Field Selector</label>
                      <input
                        type="text"
                        className="capture-url-input"
                        placeholder="Auto-detected (or input[type=password])"
                        value={authPasswordSelector}
                        onChange={(e) => setAuthPasswordSelector(e.target.value)}
                      />
                    </div>
                    <div className="auth-cap-field">
                      <label className="auth-cap-label">Submit Button Selector</label>
                      <input
                        type="text"
                        className="capture-url-input"
                        placeholder="Auto-detected (or button[type=submit])"
                        value={authSubmitSelector}
                        onChange={(e) => setAuthSubmitSelector(e.target.value)}
                      />
                    </div>
                    <div className="auth-cap-field">
                      <label className="auth-cap-label">Success URL Contains</label>
                      <input
                        type="text"
                        className="capture-url-input"
                        placeholder="e.g. /dashboard or /app"
                        value={authSuccessUrl}
                        onChange={(e) => setAuthSuccessUrl(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── SHARED OPTIONS ── */}
          <div className="capture-options" style={{ marginTop: 14 }}>
            <label className="capture-option-check">
              <input
                type="checkbox"
                checked={captureOpts.interact}
                onChange={(e) => setCaptureOpts((o) => ({ ...o, interact: e.target.checked }))}
              />
              Interact with page (scroll + click navigation to trigger calls)
            </label>
            <label className="capture-option-check">
              <input
                type="checkbox"
                checked={captureOpts.dedupe}
                onChange={(e) => setCaptureOpts((o) => ({ ...o, dedupe: e.target.checked }))}
              />
              De-duplicate identical requests
            </label>
            <label className="capture-option-check">
              <input
                type="checkbox"
                checked={captureOpts.inject_auth}
                onChange={(e) => setCaptureOpts((o) => ({ ...o, inject_auth: e.target.checked }))}
              />
              Inject Authorization header skeleton
            </label>
            <label className="capture-option-check">
              Wait time (ms):
              <input
                type="number"
                className="capture-wait-input"
                value={captureOpts.wait_ms}
                min={1000}
                step={500}
                onChange={(e) => setCaptureOpts((o) => ({ ...o, wait_ms: +e.target.value }))}
              />
            </label>
          </div>

          <hr className="section-divider" />

          {captureError && <div className="capture-error">⚠ {captureError}</div>}

          {captureLoading && (
            <div className="capture-loading">
              <div className="capture-spinner" />
              {captureAuthMode === "auth"
                ? `Launching headless browser, logging into ${authLoginUrl}, and capturing authenticated network calls…`
                : `Opening browser and capturing API calls from ${captureUrl}…`}
            </div>
          )}

          {/* ── Authenticated Capture Metadata Pill Banner ── */}
          {authCaptureMeta && (
            <div className="auth-meta-banner">
              <span className={`auth-meta-chip ${authCaptureMeta.login_success ? "success" : "warn"}`}>
                <CheckCircle size={12} /> Login: {authCaptureMeta.login_success ? "Verified" : "Uncertain"}
              </span>
              <span className="auth-meta-chip info">
                <Globe size={12} /> Cookies Saved: {authCaptureMeta.cookies_count}
              </span>
              <span className={`auth-meta-chip ${authCaptureMeta.token_found ? "success" : "muted"}`}>
                <Shield size={12} /> Bearer Token: {authCaptureMeta.token_found ? "Captured" : "Cookie-based"}
              </span>
              <span className="auth-meta-msg">{authCaptureMeta.message}</span>
            </div>
          )}

          {capturedScenario.length > 0 && (
            <>
              <p className="section-label" style={{ marginBottom: 12 }}>
                Captured API calls — {capturedScenario.length} found
              </p>
              <div className="capture-table-wrapper">
                <table className="capture-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>#</th>
                      <th style={{ width: 44 }}>On</th>
                      <th style={{ width: 80 }}>Method</th>
                      <th>URL</th>
                      <th style={{ width: 60 }}>Body</th>
                      <th style={{ width: 100 }}>Extract</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capturedScenario.map((step, i) => (
                      <tr key={i} className={!step.enabled ? "capture-row-disabled" : ""}>
                        <td>{i + 1}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={!!step.enabled}
                            onChange={() => toggleCapturedStep(i)}
                          />
                        </td>
                        <td>
                          <span className={`method-badge method-badge--${step.method?.toLowerCase()}`}>
                            {step.method}
                          </span>
                        </td>
                        <td className="capture-url-cell">{step.url}</td>
                        <td style={{ textAlign: "center" }}>{step.body ? "✓" : "—"}</td>
                        <td style={{ fontSize: 12, color: "#6b7280" }}>
                          {step.extractVariable ? `→ ${step.variableName}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="capture-actions">
                <p className="capture-actions-hint">
                  Toggle steps on/off, then click "Import into Scenario" to move them into the manual builder and configure test settings.
                </p>
                <button
                  type="button"
                  className="submit-btn"
                  style={{ marginTop: 0, maxWidth: 320 }}
                  onClick={handleImportScenario}
                >
                  <PlayCircle size={16} /> Import into Scenario Builder
                </button>
              </div>
            </>
          )}

          {!captureLoading && !captureError && capturedScenario.length === 0 && (
            <div className="capture-empty">
              <Globe size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
              <p>No API calls captured yet.</p>
              <p style={{ fontSize: 12, color: "#9ca3af" }}>
                {captureAuthMode === "auth"
                  ? "Enter your login details above and click 'Capture Authenticated APIs'."
                  : "Enter your public app URL above and click 'Capture APIs'."}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── NEW: Import from Swagger / OpenAPI ─────────────────────────────
          Same discover → select → import flow as Auto Capture above, but the
          source is a swagger.json / openapi.json URL instead of a live
          browser capture. */}
      {mode === "swagger" && (
        <div className="create-form">
          <p className="section-label"><Link2 size={13} /> Swagger / OpenAPI URL</p>
          <div className="capture-url-row">
            <input
              type="url"
              className="capture-url-input"
              placeholder="https://petstore.swagger.io/v2/swagger.json"
              value={swaggerUrl}
              onChange={(e) => setSwaggerUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); discoverApis(); } }}
            />
            <button type="button" className="capture-btn" onClick={discoverApis} disabled={swaggerLoading || !swaggerUrl.trim()}>
              {swaggerLoading ? <><Loader2 size={14} className="spin" /> Discovering…</> : <><Search size={14} /> Discover APIs</>}
            </button>
          </div>

          <hr className="section-divider" />

          {swaggerError && <div className="capture-error"><AlertCircle size={14} style={{ marginRight: 4 }} /> {swaggerError}</div>}

          {swaggerLoading && (
            <div className="capture-loading">
              <div className="capture-spinner" />
              Reading API definitions from <strong>{swaggerUrl}</strong>…
            </div>
          )}

          {discoveredApis.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                <p className="section-label" style={{ marginBottom: 0 }}>
                  Discovered APIs — {selectedApiIndexes.size} of {discoveredApis.length} selected
                </p>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" className="capture-btn" style={{ padding: "4px 10px" }} onClick={() => setSelectedApiIndexes(new Set(discoveredApis.map((_, i) => i)))}>Select all</button>
                  <button type="button" className="capture-btn" style={{ padding: "4px 10px" }} onClick={() => setSelectedApiIndexes(new Set())}>Clear</button>
                </div>
              </div>

              <div className="capture-table-wrapper">
                <table className="capture-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>#</th>
                      <th style={{ width: 44 }}>On</th>
                      <th style={{ width: 80 }}>Method</th>
                      <th>Path</th>
                      <th>Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discoveredApis.map((api, i) => {
                      const isSelected = selectedApiIndexes.has(i);
                      return (
                        <tr key={i} className={!isSelected ? "capture-row-disabled" : ""}>
                          <td>{i + 1}</td>
                          <td><input type="checkbox" checked={isSelected} onChange={() => toggleApiSelection(i)} /></td>
                          <td><span className={`method-badge method-badge--${api.method?.toLowerCase()}`}>{api.method}</span></td>
                          <td className="capture-url-cell">{api.path}</td>
                          <td style={{ fontSize: 12, color: "#6b7280" }}>{api.summary || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="capture-actions">
                <p className="capture-actions-hint">
                  Toggle APIs on/off, then click "Import into Scenario" to move them into the manual builder and configure test settings.
                </p>
                <button
                  type="button"
                  className="submit-btn"
                  style={{ marginTop: 0, maxWidth: 320 }}
                  disabled={importingApis || selectedApiIndexes.size === 0}
                  onClick={importSelectedApis}
                >
                  <PlayCircle size={16} /> {importingApis ? "Importing…" : `Import ${selectedApiIndexes.size} selected request${selectedApiIndexes.size === 1 ? "" : "s"}`}
                </button>
              </div>
            </>
          )}

          {!swaggerLoading && !swaggerError && discoveredApis.length === 0 && swaggerUrl && (
            <div className="capture-empty">
              <Link2 size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
              <p>No APIs discovered yet.</p>
              <p style={{ fontSize: 12, color: "#9ca3af" }}>Enter a Swagger/OpenAPI URL above and click "Discover APIs".</p>
            </div>
          )}
        </div>
      )}

      {(mode === "workload") && (
        <form id="ct-form" className="create-form" onSubmit={handleSubmit}>
          <p className="section-label">Workload & Execution Settings</p>
          <div className="form-grid">
            <div className="form-group"><label>Test Name</label><input type="text" name="testName" value={formData.testName} onChange={handleChange} placeholder="My Performance Test" /></div>
            <div className="form-group"><label>Virtual Users (VUs)</label><input type="number" name="users" value={formData.users} onChange={handleChange} min={1} /></div>
            <div className="form-group"><label>Ramp-Up (sec)</label><input type="number" name="rampUp" value={formData.rampUp} onChange={handleChange} min={0} /></div>
            <div className="form-group"><label>Duration (sec)</label><input type="number" name="duration" value={formData.duration} onChange={handleChange} min={1} /></div>
            <div className="form-group"><label>Loop Count</label><input type="number" name="loopCount" value={formData.loopCount} onChange={handleChange} min={1} /></div>
          </div>
          <hr className="section-divider" />
          <p className="section-label"><input type="checkbox" name="enableAssertions" checked={formData.enableAssertions} onChange={handleChange} style={{ marginRight:6 }} />Global Assertions / SLA Thresholds</p>
          {formData.enableAssertions && (
            <div className="form-grid">
              <div className="form-group"><label>Expected Status Code</label><input type="number" name="status_code" value={formData.assertions.status_code} onChange={handleChange} /></div>
              <div className="form-group"><label>Max Response Time (ms)</label><input type="number" name="max_response_time" value={formData.assertions.max_response_time} onChange={handleChange} /></div>
              <div className="form-group"><label>Max Error Rate (%)</label><input type="number" name="max_error_rate" value={formData.assertions.max_error_rate} onChange={handleChange} /></div>
            </div>
          )}
          <button type="submit" className="submit-btn"><FilePlus size={15} /> {id ? "Update Test" : "Save & Proceed"}</button>
        </form>
      )}

      {(mode === "engine") && (
        <form id="ct-form" className="create-form" onSubmit={handleSubmit}>
          <p className="section-label">Engine & Parameters</p>
          <p className="section-label"><input type="checkbox" name="enableScheduling" checked={formData.enableScheduling} onChange={handleChange} style={{ marginRight:6 }} />Enable Scheduling (JMeter Scheduler)</p>
          {formData.enableScheduling && (
            <div className="schedule-box" style={{ background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--r2)",padding:"14px 16px",marginBottom:14 }}>
              <div className="schedule-grid" style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14 }}>
                <div className="form-group"><label>Start Time</label><input type="datetime-local" value={formData.schedule.startTime} onChange={(e) => updateSchedule("startTime", e.target.value)} /></div>
                <div className="form-group"><label>Frequency</label>
                  <select value={formData.schedule.frequency} onChange={(e) => updateSchedule("frequency", e.target.value)}>
                    <option value="once">Once</option><option value="daily">Daily</option>
                    <option value="weekly">Weekly</option><option value="monthly">Monthly</option>
                  </select>
                </div>
                <div className="form-group"><label>End Time (Optional)</label><input type="datetime-local" value={formData.schedule.endTime} onChange={(e) => updateSchedule("endTime", e.target.value)} /></div>
              </div>
            </div>
          )}
          <hr className="section-divider" />
          <p className="section-label"><input type="checkbox" name="enableUserDefinedVariables" checked={formData.enableUserDefinedVariables} onChange={handleChange} style={{ marginRight:6 }} />User Defined Variables (UDV)</p>
          {formData.enableUserDefinedVariables && (
            <div className="udv-box" style={{ background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--r2)",padding:"14px 16px",marginBottom:14 }}>
              {formData.userDefinedVariables.map((v) => (
                <div key={v.id} style={{ display:"grid",gridTemplateColumns:"20px 1fr 1fr 1.5fr 26px",gap:8,marginBottom:8,alignItems:"center",opacity:v.enabled?1:0.5 }}>
                  <input type="checkbox" checked={v.enabled} onChange={(e) => updateUDV(v.id, "enabled", e.target.checked)} />
                  <input className="full-width" style={{ background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--r)",color:"var(--tx)",fontSize:12,padding:"6px 9px" }} placeholder="Name" value={v.name} disabled={!v.enabled} onChange={(e) => updateUDV(v.id, "name", e.target.value)} />
                  <input className="full-width" style={{ background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--r)",color:"var(--tx)",fontSize:12,padding:"6px 9px" }} placeholder="Value" value={v.value} disabled={!v.enabled} onChange={(e) => updateUDV(v.id, "value", e.target.value)} />
                  <input className="full-width" style={{ background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--r)",color:"var(--tx)",fontSize:12,padding:"6px 9px" }} placeholder="Description" value={v.description} disabled={!v.enabled} onChange={(e) => updateUDV(v.id, "description", e.target.value)} />
                  <button type="button" style={{ background:"var(--red-dim)",color:"var(--red-tx)",border:"none",borderRadius:"var(--r)",cursor:"pointer",padding:"5px",display:"flex",alignItems:"center" }} onClick={() => removeUDV(v.id)}><Trash2 size={12} /></button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop:8 }} onClick={addUDV}><Plus size={13} /> Add Variable</button>
            </div>
          )}
          <hr className="section-divider" />
          <p className="section-label"><input type="checkbox" name="enableCsvConfig" checked={formData.enableCsvConfig} onChange={handleChange} style={{ marginRight:6 }} />CSV Data Configuration</p>
          {formData.enableCsvConfig && (
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14 }}>
              <div className="form-group"><label>CSV File</label><input type="file" name="csv_file" accept=".csv" onChange={handleChange} style={{ background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--r)",color:"var(--tx)",padding:"8px 12px",fontSize:12 }} /></div>
              <div className="form-group"><label>Variable Names (comma-separated)</label><input type="text" name="variable_name" value={formData.csvConfig.variable_name} onChange={handleChange} placeholder="username,password" /></div>
            </div>
          )}
          <hr className="section-divider" />
          <p className="section-label"><input type="checkbox" name="enableCookieManager" checked={formData.enableCookieManager} onChange={handleChange} style={{ marginRight:6 }} />HTTP Cookie Manager</p>
          {formData.enableCookieManager && (
            <label style={{ display:"flex",alignItems:"center",gap:8,fontSize:13,color:"var(--tx2)",marginBottom:14 }}>
              <input type="checkbox" checked={formData.cookieConfig.clearEachIteration} onChange={(e) => setFormData({ ...formData, cookieConfig: { ...formData.cookieConfig, clearEachIteration: e.target.checked } })} />
              Clear cookies each iteration
            </label>
          )}
          <hr className="section-divider" />
          <p className="section-label"><input type="checkbox" name="enableCacheManager" checked={formData.enableCacheManager} onChange={handleChange} style={{ marginRight:6 }} />HTTP Cache Manager</p>
          {formData.enableCacheManager && (
            <div style={{ display:"flex",alignItems:"center",gap:16,marginBottom:14,flexWrap:"wrap" }}>
              <label style={{ display:"flex",alignItems:"center",gap:8,fontSize:13,color:"var(--tx2)" }}>
                <input type="checkbox" checked={formData.cacheConfig.clearEachIteration} onChange={(e) => setFormData({ ...formData, cacheConfig: { ...formData.cacheConfig, clearEachIteration: e.target.checked } })} />
                Clear cache each iteration
              </label>
              <div className="form-group" style={{ flex:1,maxWidth:200 }}>
                <label>Max Cache Entries</label>
                <input type="number" min="1" max="5000" value={formData.cacheConfig.maxSize} onChange={(e) => setFormData({ ...formData, cacheConfig: { ...formData.cacheConfig, maxSize: Number(e.target.value) } })} />
              </div>
            </div>
          )}
          <button type="submit" className="submit-btn"><FilePlus size={15} /> {id ? "Update Test" : "Save & Proceed"}</button>
        </form>
      )}
            {mode === "manual" && (
        <form id="ct-form" className="create-form" onSubmit={handleSubmit}>
          <div className="scenario-section">
            <div className="scenario-header">
              <h3>Scenario builder</h3>
              <button type="button" className="add-step-btn" onClick={addScenarioStep}><Plus size={14} /> Add step</button>
            </div>

            {/* Captured variables bar — click a chip to insert {{var}} into whichever
                URL / Headers / Body field you last clicked into. This is how a token
                extracted from Step 1's preview response gets chained into Step 2. */}
            {Object.keys(previewVariables).length > 0 && (
              <div className="preview-vars-bar">
                <span className="preview-vars-label">
                  <Zap size={12} /> Captured from previews — click to insert into the field you last clicked:
                </span>
                <div className="preview-vars-chips">
                  {Object.entries(previewVariables).map(([key, value]) => (
                    <button key={key} type="button" className="preview-var-chip" title={`Value: ${String(value).slice(0, 80)}`} onClick={() => insertVariableIntoField(key)}>
                      {`{{${key}}}`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={scenario.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                {scenario.map((step, index) => {
                  const preview = stepPreviews[step.id];
                  return (
                  <SortableStep key={step.id} id={step.id}>
                    {({ attributes, listeners }) => (
                      <div className="scenario-card">
                        <div className="step-header">
                          <div className="step-left">
                            <div className="drag-handle" {...attributes} {...listeners}><GripVertical size={18} /></div>
                            <span className="step-title">Step {index + 1}</span>
                          </div>
                          <div className="step-actions">
                            <button
                              type="button"
                              className="preview-run-btn"
                              onClick={() => runStepPreview(step)}
                              disabled={preview?.loading || !step.url.trim()}
                              title="Run this single request and view the real JSON response"
                            >
                              <Play size={14} />
                              {preview?.loading ? "Running…" : "Run & Preview"}
                            </button>
                            <button type="button" className="duplicate-btn" onClick={() => duplicateStep(step.id)} title="Duplicate step">
                              <Copy size={14} /> Duplicate
                            </button>
                            <button type="button" className="delete-btn" onClick={() => removeStep(step.id)} title="Delete step">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        <div className="step-grid">
                          <label className="enable-box">
                            <input type="checkbox" checked={step.enabled} onChange={(e) => updateStep(step.id, "enabled", e.target.checked)} />
                            Enable
                          </label>
                          <input className="request-name" type="text" value={step.name} onChange={(e) => updateStep(step.id, "name", e.target.value)} placeholder="Request Name" />
                          <select className="method-box" value={step.method} onChange={(e) => updateStep(step.id, "method", e.target.value)}>
                            <option value="GET">GET</option>
                            <option value="POST">POST</option>
                            <option value="PUT">PUT</option>
                            <option value="DELETE">DELETE</option>
                          </select>
                          <input className="think-box" type="number" placeholder="Think Time(ms)" value={step.thinkTime} onChange={(e) => updateStep(step.id, "thinkTime", e.target.value)} />
                          <input
                            className="full-width"
                            type="text"
                            placeholder="Request URL"
                            value={step.url}
                            onChange={(e) => updateStep(step.id, "url", e.target.value)}
                            onFocus={trackFocus(step.id, "url")}
                          />
                          <textarea
                            className="header-box full-width"
                            placeholder="Headers (JSON)"
                            value={step.headers}
                            onChange={(e) => updateStep(step.id, "headers", e.target.value)}
                            onFocus={trackFocus(step.id, "headers")}
                          />
                          <textarea
                            className="body-box full-width"
                            placeholder="Request Body (JSON)"
                            value={step.body}
                            onChange={(e) => updateStep(step.id, "body", e.target.value)}
                            onFocus={trackFocus(step.id, "body")}
                          />
                        </div>

                        {/* EXTRACT VARIABLE — single block, used both for entry and for
                            previewing what jsonPath will actually pull out of a response. */}
                        <div className="extract-box">
                          <label className="extract-toggle">
                            <input type="checkbox" checked={step.extractVariable} onChange={(e) => updateStep(step.id, "extractVariable", e.target.checked)} />
                            <strong>Extract Variable from JSON Response</strong>
                          </label>
                          {step.extractVariable && (
                            <div className="extract-fields">
                              <div>
                                <label>Variable Name</label>
                                <input placeholder="e.g. authToken, userId, access_token" value={step.variableName} onChange={(e) => updateStep(step.id, "variableName", e.target.value)} />
                              </div>
                              <div>
                                <label>JSON Path</label>
                                <input placeholder="e.g. $.token or $.data.user.id" value={step.jsonPath} onChange={(e) => updateStep(step.id, "jsonPath", e.target.value)} />
                                <small className="jsonpath-help">
                                  <Info size={12} /> Common examples: <code>$.token</code>, <code>$.data.id</code>, <code>$.accessToken</code>.
                                  Click "Run & Preview" below, then click any value in the JSON tree to auto-fill this path.
                                </small>
                              </div>
                            </div>
                          )}
                        </div>


                        {step.method === "GET" && (
                          <div className="params-box">
                            <div className="params-header">
                              <span className="params-label">Parameters</span>
                              <button type="button" className="add-param-btn" onClick={() => addParam(step.id)}><Plus size={12} /> Add Parameter</button>
                            </div>
                            {step.params && step.params.length > 0 && (
                              <div className="params-table">
                                <div className="params-row params-row-header">
                                  <span className="params-col-enable"></span>
                                  <span className="params-col-name">Name</span>
                                  <span className="params-col-value">Value</span>
                                  <span className="params-col-action"></span>
                                </div>
                                {step.params.map((param) => (
                                  <div className="params-row" key={param.id}>
                                    <span className="params-col-enable"><input type="checkbox" checked={param.enabled} onChange={(e) => updateParam(step.id, param.id, "enabled", e.target.checked)} /></span>
                                    <span className="params-col-name"><input type="text" placeholder="Parameter name" value={param.name} onChange={(e) => updateParam(step.id, param.id, "name", e.target.value)} /></span>
                                    <span className="params-col-value"><input type="text" placeholder="Value" value={param.value} onChange={(e) => updateParam(step.id, param.id, "value", e.target.value)} /></span>
                                    <span className="params-col-action"><button type="button" className="remove-param-btn" onClick={() => removeParam(step.id, param.id)}><Trash2 size={13} /></button></span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* RESPONSE PREVIEW — JMeter "View Results Tree" equivalent,
                            now with a clickable JSON Path Finder + search. */}
                        {preview && (
                          <div className="response-preview-box">
                            <div className="response-preview-header" onClick={() => toggleStepPreview(step.id)}>
                              <span className="response-preview-title">
                                Response Preview
                                {preview.response && (
                                  <span className={`status-pill ${preview.response.status < 400 ? "status-pill--ok" : "status-pill--err"}`}>
                                    {preview.response.status}
                                  </span>
                                )}
                                {preview.response?.elapsed_ms != null && (
                                  <span className="response-elapsed">{preview.response.elapsed_ms} ms</span>
                                )}
                              </span>
                              {preview.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </div>

                            {preview.expanded && (
                              <div className="response-preview-body">
                                {preview.error && <div className="capture-error">⚠ {preview.error}</div>}

                                {preview.response && (
                                  <>
                                    {preview.response.body_json !== null && preview.response.body_json !== undefined && (
                                      <div className="json-toolbar">
                                        <div className="json-view-toggle">
                                          <button
                                            type="button"
                                            className={`json-view-btn${(preview.viewMode || "tree") === "tree" ? " active" : ""}`}
                                            onClick={() => setPreviewViewMode(step.id, "tree")}
                                          >
                                            Tree (find path)
                                          </button>
                                          <button
                                            type="button"
                                            className={`json-view-btn${preview.viewMode === "raw" ? " active" : ""}`}
                                            onClick={() => setPreviewViewMode(step.id, "raw")}
                                          >
                                            Raw
                                          </button>
                                        </div>
                                        <div className="json-search-box">
                                          <Search size={13} />
                                          <input
                                            type="text"
                                            placeholder="Search key or value…"
                                            value={preview.searchTerm || ""}
                                            onChange={(e) => setPreviewSearch(step.id, e.target.value)}
                                          />
                                        </div>
                                      </div>
                                    )}

                                    {preview.response.body_json !== null && preview.response.body_json !== undefined && (preview.viewMode || "tree") === "tree" ? (
                                      <div className="json-tree-wrapper">
                                        <JsonPathExplorer
                                          data={preview.response.body_json}
                                          searchTerm={preview.searchTerm}
                                          onSelectPath={(path) => selectJsonPath(step.id, path)}
                                        />
                                      </div>
                                    ) : (
                                      <pre className="response-json">
                                        {JSON.stringify(
                                          preview.response.body_json !== null && preview.response.body_json !== undefined
                                            ? preview.response.body_json
                                            : preview.response.body_text,
                                          null,
                                          2
                                        )}
                                      </pre>
                                    )}

                                    {step.extractVariable && (
                                      <div className={`extract-result-hint ${preview.extractedValue !== undefined ? "extract-result-hint--ok" : "extract-result-hint--warn"}`}>
                                        {preview.extractedValue !== undefined ? (
                                          <>
                                            ✓ Extracted <strong>{step.variableName}</strong> = <code>{String(preview.extractedValue)}</code>.
                                            Use <code>{`{{${step.variableName}}}`}</code> in a later step's URL, headers, or body — or click the chip above.
                                          </>
                                        ) : (
                                          <> JSON path "{step.jsonPath}" did not match anything in this response. Check the path against the JSON above, or click a value in the Tree view to set it automatically.</>
                                        )}
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* ASSERTIONS */}
                        <div className="assertion-box">
                          <label className="extract-toggle">
                            <input type="checkbox" checked={step.assertions.enabled} onChange={(e) => updateStepAssertion(step.id, "enabled", e.target.checked)} />
                            Enable Assertions
                          </label>
                          {step.assertions.enabled && (
                            <>
                              <div className="assertion-section-label">Response Metrics</div>
                              <div className="extract-fields">
                                <input type="number" placeholder="Expected Status Code" value={step.assertions.status_code} onChange={(e) => updateStepAssertion(step.id, "status_code", e.target.value)} />
                                <input type="number" placeholder="Max Response Time (ms)" value={step.assertions.max_response_time} onChange={(e) => updateStepAssertion(step.id, "max_response_time", e.target.value)} />
                              </div>
                              <div className="assertion-section-label" style={{ marginTop: "14px" }}>
                                Response Assertions
                                <button type="button" className="add-text-assertion-btn" onClick={() => addTextAssertion(step.id)}><Plus size={12} /> Add</button>
                              </div>
                              {(step.assertions.text_assertions || []).length === 0 && (
                                <p className="no-assertion-hint">No response assertions added. Click "+ Add" to check response body, headers, or status text.</p>
                              )}
                              {(step.assertions.text_assertions || []).map((ta) => (
                                <div className="text-assertion-row" key={ta.id}>
                                  <select className="ta-select" value={ta.field} onChange={(e) => updateTextAssertion(step.id, ta.id, "field", e.target.value)}>
                                    <option value="body">Response Body</option>
                                    <option value="status_text">Status Text</option>
                                    <option value="headers">Response Headers</option>
                                  </select>
                                  <select className="ta-select" value={ta.condition} onChange={(e) => updateTextAssertion(step.id, ta.id, "condition", e.target.value)}>
                                    <option value="contains">Contains</option>
                                    <option value="not_contains">Not Contains</option>
                                    <option value="equals">Equals</option>
                                    <option value="starts_with">Starts With</option>
                                    <option value="ends_with">Ends With</option>
                                    <option value="matches_regex">Matches Regex</option>
                                  </select>
                                  <input className="ta-value" type="text" placeholder='e.g. "userId"' value={ta.value} onChange={(e) => updateTextAssertion(step.id, ta.id, "value", e.target.value)} />
                                  <button type="button" className="remove-param-btn" onClick={() => removeTextAssertion(step.id, ta.id)}><Trash2 size={13} /></button>
                                </div>
                              ))}
                            </>
                          )}
                        </div>

                        {/* RETRY */}
                        <div className="retry-box">
                          <label className="extract-toggle">
                            <input type="checkbox" checked={step.retry?.enabled ?? false} onChange={(e) => updateRetry(step.id, "enabled", e.target.checked)} />
                            Enable Retry Logic
                          </label>
                          {step.retry?.enabled && (
                            <div className="retry-body">
                              <div className="retry-fields">
                                <div className="retry-field-group">
                                  <label>Max Retries</label>
                                  <input type="number" min="1" max="10" value={step.retry.maxRetries} onChange={(e) => updateRetry(step.id, "maxRetries", Number(e.target.value))} />
                                  <span className="retry-hint">attempts after first failure</span>
                                </div>
                                <div className="retry-field-group">
                                  <label>Retry Delay (ms)</label>
                                  <input type="number" min="0" step="100" value={step.retry.retryDelay} onChange={(e) => updateRetry(step.id, "retryDelay", Number(e.target.value))} />
                                  <span className="retry-hint">wait between retries</span>
                                </div>
                              </div>
                              <label className="retry-timeout-checkbox">
                                <input type="checkbox" checked={step.retry.retryOnTimeout} onChange={(e) => updateRetry(step.id, "retryOnTimeout", e.target.checked)} />
                                Retry on connection timeout / network error
                              </label>
                              <div className="retry-codes-section">
                                <span className="retry-codes-label">Retry on HTTP status codes</span>
                                <div className="retry-code-chips">
                                  {[408, 429, 500, 502, 503, 504].map((code) => (
                                    <button key={code} type="button" className={`retry-code-chip${step.retry.retryOn.includes(code) ? " active" : ""}`} onClick={() => toggleRetryCode(step.id, code)}>{code}</button>
                                  ))}
                                  {step.retry.retryOn.filter((c) => ![408, 429, 500, 502, 503, 504].includes(c)).map((code) => (
                                    <span key={code} className="retry-code-chip active retry-code-custom">
                                      {code}
                                      <button type="button" className="retry-code-remove" onClick={() => removeRetryCode(step.id, code)}>×</button>
                                    </span>
                                  ))}
                                </div>
                                <div className="retry-custom-code-row">
                                  <input type="number" className="retry-custom-code-input" placeholder="Custom code, e.g. 429" min="100" max="599" id={`custom-retry-${step.id}`} />
                                  <button type="button" className="add-param-btn" onClick={() => { const el = document.getElementById(`custom-retry-${step.id}`); if (addCustomRetryCode(step.id, el.value)) el.value = ""; }}>
                                    <Plus size={12} /> Add
                                  </button>
                                </div>
                              </div>
                              <p className="retry-summary">
                                Will retry up to <strong>{step.retry.maxRetries}×</strong> with a <strong>{step.retry.retryDelay} ms</strong> delay on{" "}
                                {step.retry.retryOn.length > 0 ? `HTTP ${step.retry.retryOn.slice().sort((a, b) => a - b).join(", ")}` : "no status codes"}
                                {step.retry.retryOnTimeout ? " and timeouts" : ""}.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </SortableStep>
                  );
                })}
              </SortableContext>
            </DndContext>
          </div>

          <button type="submit" className="submit-btn">
            <PlayCircle size={16} />
            {id ? "Update Test" : "Create Test"}
          </button>
        </form>
      )}
    </div>
    </Layout>
  );
}

export default CreateTest;