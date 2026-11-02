import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";


const aggregateResponseTime = new Trend("aggregate_response_time", true);
const aggregateErrors       = new Counter("aggregate_errors");
const aggregateFailureRate  = new Rate("aggregate_failure_rate");




export const options = {
    stages: [
        { duration: "10s", target: 20 },
        { duration: "25s", target: 20 },
        { duration: "5s", target: 0 },
    ],
    thresholds: {
        'http_req_duration': ['p(95)<2000'],
        'http_req_failed': ['rate<=0.0100'],
    }
};

export default function () {
    
    const variables = {};
    

    
    

    for (let i = 0; i < 1; i++) {
        
        
        

        // ── Computers data (with retry logic) ──
        let res_0;
        {
            const __retryCodes_0 = [500, 502, 503];
            const __maxRetries_0 = 3;
            const __retryDelay_0 = 1000;
            const __retryOnTimeout_0 = true;

            for (let __attempt_0 = 0; __attempt_0 <= __maxRetries_0; __attempt_0++) {
                try {
                    res_0 = http.get(`https://demowebshop.tricentis.com/computers`, {
            headers: {},
            
        });

                    if (!__retryCodes_0.includes(res_0.status)) {
                        if (__attempt_0 > 0) {
                            console.log("Retry succeeded for Computers data on attempt", __attempt_0 + 1);
                        }
                        break;
                    }

                    if (__attempt_0 < __maxRetries_0) {
                        console.warn(
                            "Retrying Computers data (attempt", __attempt_0 + 1, "of", __maxRetries_0,
                            ") — status:", res_0.status
                        );
                        sleep(__retryDelay_0 / 1000);
                    } else {
                        console.error("Computers data failed after", __maxRetries_0, "retries — status:", res_0.status);
                    }
                } catch (__err_0) {
                    if (__retryOnTimeout_0 && __attempt_0 < __maxRetries_0) {
                        console.warn(
                            "Retrying Computers data after error (attempt", __attempt_0 + 1, "):", __err_0.message
                        );
                        sleep(__retryDelay_0 / 1000);
                    } else {
                        console.error("Computers data network error after retries:", __err_0.message);
                        throw __err_0;
                    }
                }
            }
        }

        console.log("Request: Computers data");
        console.log("Status:", res_0.status);
        console.log("Body:", res_0.body);

        aggregateResponseTime.add(res_0.timings.duration);

        if (res_0.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }

        check(res_0, {
            "Computers data status 200": (r) => r.status === 200,
            "Computers data response time < 500ms": (r) => r.timings.duration <= 500
        });

        // ── Desktops ──
        let res_1 = http.get(`https://demowebshop.tricentis.com/desktops`, {
            headers: {},
            
        });

        console.log("Request: Desktops");
        console.log("Status:", res_1.status);
        console.log("Body:", res_1.body);

        aggregateResponseTime.add(res_1.timings.duration);

        if (res_1.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }

        check(res_1, {
            "status 200": (r) => r.status === 200,
            "response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Notebooks data ──
        let res_2 = http.get(`https://demowebshop.tricentis.com/notebooks`, {
            headers: {},
            
        });

        console.log("Request: Notebooks data");
        console.log("Status:", res_2.status);
        console.log("Body:", res_2.body);

        aggregateResponseTime.add(res_2.timings.duration);

        if (res_2.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }

        check(res_2, {
            "status 200": (r) => r.status === 200,
            "response time < 2000ms": (r) => r.timings.duration <= 2000
        });

    }
}
