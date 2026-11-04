import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";


const aggregateResponseTime = new Trend("aggregate_response_time", true);
const aggregateErrors       = new Counter("aggregate_errors");
const aggregateFailureRate  = new Rate("aggregate_failure_rate");




export const options = {
    stages: [
        { duration: "2s", target: 2 },
        { duration: "1s", target: 2 },
        { duration: "5s", target: 0 },
    ],
};

export default function () {
    
    const variables = {
    access_token: (__ENV.ACCESS_TOKEN || "")
};
    

    
    

    for (let i = 0; i < 0; i++) {
        // Cookie Manager disabled - clearing cookies each iteration
  
        
    // Cache disabled
    
        

        // ── B2C Login ──
        let res_0 = http.request(
            "POST",
            `https://api-sandbox.dwtc.com/pms/api/v1/auth/session`,
            "{\n  \"azureToken\": {{access_token}},\n  \"tokenType\": \"b2c\",\n  \"deviceId\": \"crypto.randomUUID()\"\n}",
            { headers: {
  "Content-Type": "application/json",
  "accept": "application/json",
  "Authorization": "Bearer ${token}",
  "Ocp-Apim-subscription-key": "63cedf5ec86140c28f15badae27aa810",
  "X-PMS-Webhook-Key": "e5837221-db4d-45c8-b327-02aad30c0ca5"
} }
        );

        console.log("Request: B2C Login");
        console.log("Status:", res_0.status);
        console.log("Body:", res_0.body);

        aggregateResponseTime.add(res_0.timings.duration);

        if (res_0.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }

        // Extract variable: token
        try {
            variables.token = res_0.json("token");
            console.log("Extracted token =", variables.token);
        } catch (e) {
            console.warn("Failed to extract token from path token:", e.message);
        }
        sleep(100 / 1000);

        // ── Request 2 ──
        let res_1 = http.request(
            "POST",
            `https://api-sandbox.dwtc.com/pms/api/v1/tickets/search`,
            JSON.stringify({
"licensePlate": "AA 12345"
}),
            { headers: {
  "Content-Type": "application/json",
  "accept": "application/json",
  "Authorization": "Bearer ${token}",
  "Ocp-Apim-subscription-key": "63cedf5ec86140c28f15badae27aa810",
  "X-PMS-Webhook-Key": "e5837221-db4d-45c8-b327-02aad30c0ca5"
} }
        );

        console.log("Request: Request 2");
        console.log("Status:", res_1.status);
        console.log("Body:", res_1.body);

        aggregateResponseTime.add(res_1.timings.duration);

        if (res_1.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }

    }
}
