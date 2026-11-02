import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";


const aggregateResponseTime = new Trend("aggregate_response_time", true);
const aggregateErrors       = new Counter("aggregate_errors");
const aggregateFailureRate  = new Rate("aggregate_failure_rate");


        // ── HTTP Cache Manager (JMeter equivalent) ────────────────────────────
        const __cache = {};
        let __cacheSize = 0;
        const __cacheMaxSize = 5000;
    

        // Get cache headers for conditional GET
        function getCacheHeaders(url) {
            const entry = __cache[url];
            if (!entry) return {};

            const headers = {};
            if (entry.etag) headers["If-None-Match"] = entry.etag;
            if (entry.lastModified) headers["If-Modified-Since"] = entry.lastModified;

            return headers;
        }

        // Store response in cache (JMeter Cache Manager semantics)
        function storeCacheEntry(url, res) {
            const h = res.headers || {};
            const etag = h["ETag"] || h["Etag"] || h["etag"] || null;
            const lastModified = h["Last-Modified"] || h["last-modified"] || null;

            if (res.status === 304) {
                // 304 Not Modified: cache hit, retain cached body and refresh validators
                if (__cache[url]) {
                    if (etag) __cache[url].etag = etag;
                    if (lastModified) __cache[url].lastModified = lastModified;
                }
                return;
            }

            if (res.status >= 200 && res.status < 300) {
                if (!__cache[url] && __cacheSize >= __cacheMaxSize) {
                    const oldestKey = Object.keys(__cache)[0];
                    delete __cache[oldestKey];
                    __cacheSize--;
                }

                if (!__cache[url]) __cacheSize++;

                __cache[url] = {
                    etag: etag,
                    lastModified: lastModified,
                    body: res.body,
                    status: res.status
                };
            }
        }

        // Return cached response if 304
        function getCachedResponse(url) {
            return __cache[url] || null;
        }
    

export const options = {
    stages: [
        { duration: "5s", target: 20 },
        { duration: "30s", target: 20 },
        { duration: "5s", target: 0 },
    ]
};

export default function () {
    // Scheduled Test | Frequency: once | Start: 2026-10-20T13:37
    const variables = {};
    
    const jar = http.cookieJar(); // HTTP Cookie Manager
    


    
        // Scheduler: wait until start time
        const scheduleStart = new Date("2026-10-20T13:37:00").getTime();
        if (Date.now() < scheduleStart) {
            const waitMs = scheduleStart - Date.now();
            console.log("Waiting until scheduled start:", "2026-10-20T13:37:00");
            sleep(waitMs / 1000);
        }

    

    for (let i = 0; i < 1; i++) {
        
    // Clear dynamic cookies each iteration (JMeter Cookie Manager semantics)
        jar.clear("https://demowebshop.tricentis.com");
        

        
            // Clear cache each iteration
            Object.keys(__cache).forEach(key => delete __cache[key]);
            __cacheSize = 0;
    
        

        // ── Request 1 — /login ──
        let res_0 = (() => {
            const __url_0 = `https://demowebshop.tricentis.com/login`;
            const __cacheHeaders_0 = getCacheHeaders(__url_0);
            const __mergedHeaders_0 = Object.assign({}, {
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Referer": "https://demowebshop.tricentis.com/",
  "Connection": "keep-alive",
  "Cookie": "Nop.customer=791b6b80-24cf-4d5f-aee5-9a081eff1b88; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1&RecentlyViewedProductIds=63; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Priority": "u=0, i"
}, __cacheHeaders_0);
            const __response_0 = http.get(__url_0, {
                headers: __mergedHeaders_0,
                jar: jar,
            });
            storeCacheEntry(__url_0, __response_0);
            if (__response_0.status === 304 && __cache[__url_0]) {
                const __cached_0 = __cache[__url_0];
                return Object.assign({}, __response_0, {
                    body: __cached_0.body,
                    status: 200,
                    originalStatus: 304,
                    isFromCache: true,
                    json: function (selector) {
                        try {
                            const parsed = JSON.parse(__cached_0.body);
                            if (!selector) return parsed;
                            return selector.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), parsed);
                        } catch (e) {
                            return undefined;
                        }
                    }
                });
            }
            return __response_0;
        })();

        console.log("Request: Request 1 — /login");
        console.log("Status:", res_0.status);
        console.log("Body:", res_0.body);

        aggregateResponseTime.add(res_0.timings.duration);

        if (res_0.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_0, {
            "Request 1 — /login status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 1 — /login response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 2 — /login ──
        let res_1 = http.request(
        "POST",
        `https://demowebshop.tricentis.com/login`,
        "Email=esakki3124%40gmail.com&Password=siva2004&RememberMe=false",
        { headers: {
  "Content-Type": "application/x-www-form-urlencoded",
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Content-Length": "63",
  "Origin": "https://demowebshop.tricentis.com",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/login",
  "Cookie": "Nop.customer=791b6b80-24cf-4d5f-aee5-9a081eff1b88; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1&RecentlyViewedProductIds=63; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Priority": "u=0, i"
}, jar: jar, }
    );

        console.log("Request: Request 2 — /login");
        console.log("Status:", res_1.status);
        console.log("Body:", res_1.body);

        aggregateResponseTime.add(res_1.timings.duration);

        if (res_1.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_1, {
            "Request 2 — /login status 302": (r) => r.status === 302,
            "Request 2 — /login response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 3 — / ──
        let res_2 = (() => {
            const __url_2 = `https://demowebshop.tricentis.com/`;
            const __cacheHeaders_2 = getCacheHeaders(__url_2);
            const __mergedHeaders_2 = Object.assign({}, {
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Referer": "https://demowebshop.tricentis.com/login",
  "Connection": "keep-alive",
  "Cookie": "Nop.customer=791b6b80-24cf-4d5f-aee5-9a081eff1b88; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1&RecentlyViewedProductIds=63; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Priority": "u=0, i"
}, __cacheHeaders_2);
            const __response_2 = http.get(__url_2, {
                headers: __mergedHeaders_2,
                jar: jar,
            });
            storeCacheEntry(__url_2, __response_2);
            if (__response_2.status === 304 && __cache[__url_2]) {
                const __cached_2 = __cache[__url_2];
                return Object.assign({}, __response_2, {
                    body: __cached_2.body,
                    status: 200,
                    originalStatus: 304,
                    isFromCache: true,
                    json: function (selector) {
                        try {
                            const parsed = JSON.parse(__cached_2.body);
                            if (!selector) return parsed;
                            return selector.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), parsed);
                        } catch (e) {
                            return undefined;
                        }
                    }
                });
            }
            return __response_2;
        })();

        console.log("Request: Request 3 — /");
        console.log("Status:", res_2.status);
        console.log("Body:", res_2.body);

        aggregateResponseTime.add(res_2.timings.duration);

        if (res_2.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_2, {
            "Request 3 — / status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 3 — / response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 4 — /computers ──
        let res_3 = (() => {
            const __url_3 = `https://demowebshop.tricentis.com/computers`;
            const __cacheHeaders_3 = getCacheHeaders(__url_3);
            const __mergedHeaders_3 = Object.assign({}, {
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1&RecentlyViewedProductIds=63; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Priority": "u=0, i"
}, __cacheHeaders_3);
            const __response_3 = http.get(__url_3, {
                headers: __mergedHeaders_3,
                jar: jar,
            });
            storeCacheEntry(__url_3, __response_3);
            if (__response_3.status === 304 && __cache[__url_3]) {
                const __cached_3 = __cache[__url_3];
                return Object.assign({}, __response_3, {
                    body: __cached_3.body,
                    status: 200,
                    originalStatus: 304,
                    isFromCache: true,
                    json: function (selector) {
                        try {
                            const parsed = JSON.parse(__cached_3.body);
                            if (!selector) return parsed;
                            return selector.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), parsed);
                        } catch (e) {
                            return undefined;
                        }
                    }
                });
            }
            return __response_3;
        })();

        console.log("Request: Request 4 — /computers");
        console.log("Status:", res_3.status);
        console.log("Body:", res_3.body);

        aggregateResponseTime.add(res_3.timings.duration);

        if (res_3.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_3, {
            "Request 4 — /computers status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 4 — /computers response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 5 — /desktops ──
        let res_4 = (() => {
            const __url_4 = `https://demowebshop.tricentis.com/desktops`;
            const __cacheHeaders_4 = getCacheHeaders(__url_4);
            const __mergedHeaders_4 = Object.assign({}, {
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/computers",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1&RecentlyViewedProductIds=63; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Priority": "u=0, i"
}, __cacheHeaders_4);
            const __response_4 = http.get(__url_4, {
                headers: __mergedHeaders_4,
                jar: jar,
            });
            storeCacheEntry(__url_4, __response_4);
            if (__response_4.status === 304 && __cache[__url_4]) {
                const __cached_4 = __cache[__url_4];
                return Object.assign({}, __response_4, {
                    body: __cached_4.body,
                    status: 200,
                    originalStatus: 304,
                    isFromCache: true,
                    json: function (selector) {
                        try {
                            const parsed = JSON.parse(__cached_4.body);
                            if (!selector) return parsed;
                            return selector.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), parsed);
                        } catch (e) {
                            return undefined;
                        }
                    }
                });
            }
            return __response_4;
        })();

        console.log("Request: Request 5 — /desktops");
        console.log("Status:", res_4.status);
        console.log("Body:", res_4.body);

        aggregateResponseTime.add(res_4.timings.duration);

        if (res_4.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_4, {
            "Request 5 — /desktops status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 5 — /desktops response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 6 — /addproducttocart/catalog/72/1/1 ──
        let res_5 = http.request(
        "POST",
        `https://demowebshop.tricentis.com/addproducttocart/catalog/72/1/1`,
        "{}",
        { headers: {
  "Content-Type": "application/json",
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "X-Requested-With": "XMLHttpRequest",
  "Origin": "https://demowebshop.tricentis.com",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/desktops",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1&RecentlyViewedProductIds=63; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Priority": "u=0",
  "Content-Length": "0"
}, jar: jar, }
    );

        console.log("Request: Request 6 — /addproducttocart/catalog/72/1/1");
        console.log("Status:", res_5.status);
        console.log("Body:", res_5.body);

        aggregateResponseTime.add(res_5.timings.duration);

        if (res_5.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_5, {
            "Request 6 — /addproducttocart/catalog/72/1/1 status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 6 — /addproducttocart/catalog/72/1/1 response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 7 — /build-your-cheap-own-computer ──
        let res_6 = (() => {
            const __url_6 = `https://demowebshop.tricentis.com/build-your-cheap-own-computer`;
            const __cacheHeaders_6 = getCacheHeaders(__url_6);
            const __mergedHeaders_6 = Object.assign({}, {
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/desktops",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1&RecentlyViewedProductIds=63; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Priority": "u=0, i"
}, __cacheHeaders_6);
            const __response_6 = http.get(__url_6, {
                headers: __mergedHeaders_6,
                jar: jar,
            });
            storeCacheEntry(__url_6, __response_6);
            if (__response_6.status === 304 && __cache[__url_6]) {
                const __cached_6 = __cache[__url_6];
                return Object.assign({}, __response_6, {
                    body: __cached_6.body,
                    status: 200,
                    originalStatus: 304,
                    isFromCache: true,
                    json: function (selector) {
                        try {
                            const parsed = JSON.parse(__cached_6.body);
                            if (!selector) return parsed;
                            return selector.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), parsed);
                        } catch (e) {
                            return undefined;
                        }
                    }
                });
            }
            return __response_6;
        })();

        console.log("Request: Request 7 — /build-your-cheap-own-computer");
        console.log("Status:", res_6.status);
        console.log("Body:", res_6.body);

        aggregateResponseTime.add(res_6.timings.duration);

        if (res_6.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_6, {
            "Request 7 — /build-your-cheap-own-computer status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 7 — /build-your-cheap-own-computer response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 8 — /notebooks ──
        let res_7 = (() => {
            const __url_7 = `https://demowebshop.tricentis.com/notebooks`;
            const __cacheHeaders_7 = getCacheHeaders(__url_7);
            const __mergedHeaders_7 = Object.assign({}, {
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/build-your-cheap-own-computer",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Priority": "u=0, i"
}, __cacheHeaders_7);
            const __response_7 = http.get(__url_7, {
                headers: __mergedHeaders_7,
                jar: jar,
            });
            storeCacheEntry(__url_7, __response_7);
            if (__response_7.status === 304 && __cache[__url_7]) {
                const __cached_7 = __cache[__url_7];
                return Object.assign({}, __response_7, {
                    body: __cached_7.body,
                    status: 200,
                    originalStatus: 304,
                    isFromCache: true,
                    json: function (selector) {
                        try {
                            const parsed = JSON.parse(__cached_7.body);
                            if (!selector) return parsed;
                            return selector.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), parsed);
                        } catch (e) {
                            return undefined;
                        }
                    }
                });
            }
            return __response_7;
        })();

        console.log("Request: Request 8 — /notebooks");
        console.log("Status:", res_7.status);
        console.log("Body:", res_7.body);

        aggregateResponseTime.add(res_7.timings.duration);

        if (res_7.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_7, {
            "Request 8 — /notebooks status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 8 — /notebooks response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 9 — /addproducttocart/catalog/31/1/1 ──
        let res_8 = http.request(
        "POST",
        `https://demowebshop.tricentis.com/addproducttocart/catalog/31/1/1`,
        "{}",
        { headers: {
  "Content-Type": "application/json",
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "X-Requested-With": "XMLHttpRequest",
  "Origin": "https://demowebshop.tricentis.com",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/notebooks",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Priority": "u=0",
  "Content-Length": "0"
}, jar: jar, }
    );

        console.log("Request: Request 9 — /addproducttocart/catalog/31/1/1");
        console.log("Status:", res_8.status);
        console.log("Body:", res_8.body);

        aggregateResponseTime.add(res_8.timings.duration);

        if (res_8.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_8, {
            "Request 9 — /addproducttocart/catalog/31/1/1 status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 9 — /addproducttocart/catalog/31/1/1 response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 10 — /accessories ──
        let res_9 = (() => {
            const __url_9 = `https://demowebshop.tricentis.com/accessories`;
            const __cacheHeaders_9 = getCacheHeaders(__url_9);
            const __mergedHeaders_9 = Object.assign({}, {
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/notebooks",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Priority": "u=0, i"
}, __cacheHeaders_9);
            const __response_9 = http.get(__url_9, {
                headers: __mergedHeaders_9,
                jar: jar,
            });
            storeCacheEntry(__url_9, __response_9);
            if (__response_9.status === 304 && __cache[__url_9]) {
                const __cached_9 = __cache[__url_9];
                return Object.assign({}, __response_9, {
                    body: __cached_9.body,
                    status: 200,
                    originalStatus: 304,
                    isFromCache: true,
                    json: function (selector) {
                        try {
                            const parsed = JSON.parse(__cached_9.body);
                            if (!selector) return parsed;
                            return selector.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), parsed);
                        } catch (e) {
                            return undefined;
                        }
                    }
                });
            }
            return __response_9;
        })();

        console.log("Request: Request 10 — /accessories");
        console.log("Status:", res_9.status);
        console.log("Body:", res_9.body);

        aggregateResponseTime.add(res_9.timings.duration);

        if (res_9.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_9, {
            "Request 10 — /accessories status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 10 — /accessories response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 11 — /addproducttocart/catalog/66/1/1 ──
        let res_10 = http.request(
        "POST",
        `https://demowebshop.tricentis.com/addproducttocart/catalog/66/1/1`,
        "{}",
        { headers: {
  "Content-Type": "application/json",
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "X-Requested-With": "XMLHttpRequest",
  "Origin": "https://demowebshop.tricentis.com",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/accessories",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Priority": "u=0",
  "Content-Length": "0"
}, jar: jar, }
    );

        console.log("Request: Request 11 — /addproducttocart/catalog/66/1/1");
        console.log("Status:", res_10.status);
        console.log("Body:", res_10.body);

        aggregateResponseTime.add(res_10.timings.duration);

        if (res_10.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_10, {
            "Request 11 — /addproducttocart/catalog/66/1/1 status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 11 — /addproducttocart/catalog/66/1/1 response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 12 — /apparel-shoes ──
        let res_11 = (() => {
            const __url_11 = `https://demowebshop.tricentis.com/apparel-shoes`;
            const __cacheHeaders_11 = getCacheHeaders(__url_11);
            const __mergedHeaders_11 = Object.assign({}, {
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/accessories",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Priority": "u=0, i"
}, __cacheHeaders_11);
            const __response_11 = http.get(__url_11, {
                headers: __mergedHeaders_11,
                jar: jar,
            });
            storeCacheEntry(__url_11, __response_11);
            if (__response_11.status === 304 && __cache[__url_11]) {
                const __cached_11 = __cache[__url_11];
                return Object.assign({}, __response_11, {
                    body: __cached_11.body,
                    status: 200,
                    originalStatus: 304,
                    isFromCache: true,
                    json: function (selector) {
                        try {
                            const parsed = JSON.parse(__cached_11.body);
                            if (!selector) return parsed;
                            return selector.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), parsed);
                        } catch (e) {
                            return undefined;
                        }
                    }
                });
            }
            return __response_11;
        })();

        console.log("Request: Request 12 — /apparel-shoes");
        console.log("Status:", res_11.status);
        console.log("Body:", res_11.body);

        aggregateResponseTime.add(res_11.timings.duration);

        if (res_11.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_11, {
            "Request 12 — /apparel-shoes status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 12 — /apparel-shoes response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 13 — /addproducttocart/catalog/36/1/1 ──
        let res_12 = http.request(
        "POST",
        `https://demowebshop.tricentis.com/addproducttocart/catalog/36/1/1`,
        "{}",
        { headers: {
  "Content-Type": "application/json",
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "X-Requested-With": "XMLHttpRequest",
  "Origin": "https://demowebshop.tricentis.com",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/apparel-shoes",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Priority": "u=0",
  "Content-Length": "0"
}, jar: jar, }
    );

        console.log("Request: Request 13 — /addproducttocart/catalog/36/1/1");
        console.log("Status:", res_12.status);
        console.log("Body:", res_12.body);

        aggregateResponseTime.add(res_12.timings.duration);

        if (res_12.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_12, {
            "Request 13 — /addproducttocart/catalog/36/1/1 status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 13 — /addproducttocart/catalog/36/1/1 response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 14 — /addproducttocart/catalog/29/1/1 ──
        let res_13 = http.request(
        "POST",
        `https://demowebshop.tricentis.com/addproducttocart/catalog/29/1/1`,
        "{}",
        { headers: {
  "Content-Type": "application/json",
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "X-Requested-With": "XMLHttpRequest",
  "Origin": "https://demowebshop.tricentis.com",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/apparel-shoes",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Priority": "u=0",
  "Content-Length": "0"
}, jar: jar, }
    );

        console.log("Request: Request 14 — /addproducttocart/catalog/29/1/1");
        console.log("Status:", res_13.status);
        console.log("Body:", res_13.body);

        aggregateResponseTime.add(res_13.timings.duration);

        if (res_13.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_13, {
            "Request 14 — /addproducttocart/catalog/29/1/1 status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 14 — /addproducttocart/catalog/29/1/1 response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 15 — /digital-downloads ──
        let res_14 = (() => {
            const __url_14 = `https://demowebshop.tricentis.com/digital-downloads`;
            const __cacheHeaders_14 = getCacheHeaders(__url_14);
            const __mergedHeaders_14 = Object.assign({}, {
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/apparel-shoes",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Priority": "u=0, i"
}, __cacheHeaders_14);
            const __response_14 = http.get(__url_14, {
                headers: __mergedHeaders_14,
                jar: jar,
            });
            storeCacheEntry(__url_14, __response_14);
            if (__response_14.status === 304 && __cache[__url_14]) {
                const __cached_14 = __cache[__url_14];
                return Object.assign({}, __response_14, {
                    body: __cached_14.body,
                    status: 200,
                    originalStatus: 304,
                    isFromCache: true,
                    json: function (selector) {
                        try {
                            const parsed = JSON.parse(__cached_14.body);
                            if (!selector) return parsed;
                            return selector.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), parsed);
                        } catch (e) {
                            return undefined;
                        }
                    }
                });
            }
            return __response_14;
        })();

        console.log("Request: Request 15 — /digital-downloads");
        console.log("Status:", res_14.status);
        console.log("Body:", res_14.body);

        aggregateResponseTime.add(res_14.timings.duration);

        if (res_14.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_14, {
            "Request 15 — /digital-downloads status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 15 — /digital-downloads response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 16 — /addproducttocart/catalog/51/1/1 ──
        let res_15 = http.request(
        "POST",
        `https://demowebshop.tricentis.com/addproducttocart/catalog/51/1/1`,
        "{}",
        { headers: {
  "Content-Type": "application/json",
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "X-Requested-With": "XMLHttpRequest",
  "Origin": "https://demowebshop.tricentis.com",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/digital-downloads",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Priority": "u=0",
  "Content-Length": "0"
}, jar: jar, }
    );

        console.log("Request: Request 16 — /addproducttocart/catalog/51/1/1");
        console.log("Status:", res_15.status);
        console.log("Body:", res_15.body);

        aggregateResponseTime.add(res_15.timings.duration);

        if (res_15.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_15, {
            "Request 16 — /addproducttocart/catalog/51/1/1 status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 16 — /addproducttocart/catalog/51/1/1 response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 17 — /jewelry ──
        let res_16 = (() => {
            const __url_16 = `https://demowebshop.tricentis.com/jewelry`;
            const __cacheHeaders_16 = getCacheHeaders(__url_16);
            const __mergedHeaders_16 = Object.assign({}, {
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/digital-downloads",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Priority": "u=0, i"
}, __cacheHeaders_16);
            const __response_16 = http.get(__url_16, {
                headers: __mergedHeaders_16,
                jar: jar,
            });
            storeCacheEntry(__url_16, __response_16);
            if (__response_16.status === 304 && __cache[__url_16]) {
                const __cached_16 = __cache[__url_16];
                return Object.assign({}, __response_16, {
                    body: __cached_16.body,
                    status: 200,
                    originalStatus: 304,
                    isFromCache: true,
                    json: function (selector) {
                        try {
                            const parsed = JSON.parse(__cached_16.body);
                            if (!selector) return parsed;
                            return selector.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), parsed);
                        } catch (e) {
                            return undefined;
                        }
                    }
                });
            }
            return __response_16;
        })();

        console.log("Request: Request 17 — /jewelry");
        console.log("Status:", res_16.status);
        console.log("Body:", res_16.body);

        aggregateResponseTime.add(res_16.timings.duration);

        if (res_16.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_16, {
            "Request 17 — /jewelry status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 17 — /jewelry response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 18 — /addproducttocart/catalog/14/1/1 ──
        let res_17 = http.request(
        "POST",
        `https://demowebshop.tricentis.com/addproducttocart/catalog/14/1/1`,
        "{}",
        { headers: {
  "Content-Type": "application/json",
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "X-Requested-With": "XMLHttpRequest",
  "Origin": "https://demowebshop.tricentis.com",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/jewelry",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Priority": "u=0",
  "Content-Length": "0"
}, jar: jar, }
    );

        console.log("Request: Request 18 — /addproducttocart/catalog/14/1/1");
        console.log("Status:", res_17.status);
        console.log("Body:", res_17.body);

        aggregateResponseTime.add(res_17.timings.duration);

        if (res_17.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_17, {
            "Request 18 — /addproducttocart/catalog/14/1/1 status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 18 — /addproducttocart/catalog/14/1/1 response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 19 — /cart ──
        let res_18 = (() => {
            const __url_18 = `https://demowebshop.tricentis.com/cart`;
            const __cacheHeaders_18 = getCacheHeaders(__url_18);
            const __mergedHeaders_18 = Object.assign({}, {
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/jewelry",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Priority": "u=0, i"
}, __cacheHeaders_18);
            const __response_18 = http.get(__url_18, {
                headers: __mergedHeaders_18,
                jar: jar,
            });
            storeCacheEntry(__url_18, __response_18);
            if (__response_18.status === 304 && __cache[__url_18]) {
                const __cached_18 = __cache[__url_18];
                return Object.assign({}, __response_18, {
                    body: __cached_18.body,
                    status: 200,
                    originalStatus: 304,
                    isFromCache: true,
                    json: function (selector) {
                        try {
                            const parsed = JSON.parse(__cached_18.body);
                            if (!selector) return parsed;
                            return selector.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), parsed);
                        } catch (e) {
                            return undefined;
                        }
                    }
                });
            }
            return __response_18;
        })();

        console.log("Request: Request 19 — /cart");
        console.log("Status:", res_18.status);
        console.log("Body:", res_18.body);

        aggregateResponseTime.add(res_18.timings.duration);

        if (res_18.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_18, {
            "Request 19 — /cart status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 19 — /cart response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 20 — /cart ──
        let res_19 = http.request(
        "POST",
        `https://demowebshop.tricentis.com/cart`,
        "------geckoformboundary103e049c75d8ba8170e70bd1b7f14f0\r\nContent-Disposition: form-data; name=\"itemquantity7172575\"\r\n\r\n1\r\n------geckoformboundary103e049c75d8ba8170e70bd1b7f14f0\r\nContent-Disposition: form-data; name=\"itemquantity7172576\"\r\n\r\n1\r\n------geckoformboundary103e049c75d8ba8170e70bd1b7f14f0\r\nContent-Disposition: form-data; name=\"itemquantity7172578\"\r\n\r\n1\r\n------geckoformboundary103e049c75d8ba8170e70bd1b7f14f0\r\nContent-Disposition: form-data; name=\"itemquantity7172579\"\r\n\r\n1\r\n------geckoformboundary103e049c75d8ba8170e70bd1b7f14f0\r\nContent-Disposition: form-data; name=\"itemquantity7172581\"\r\n\r\n1\r\n------geckoformboundary103e049c75d8ba8170e70bd1b7f14f0\r\nContent-Disposition: form-data; name=\"discountcouponcode\"\r\n\r\n\r\n------geckoformboundary103e049c75d8ba8170e70bd1b7f14f0\r\nContent-Disposition: form-data; name=\"giftcardcouponcode\"\r\n\r\n\r\n------geckoformboundary103e049c75d8ba8170e70bd1b7f14f0\r\nContent-Disposition: form-data; name=\"CountryId\"\r\n\r\n41\r\n------geckoformboundary103e049c75d8ba8170e70bd1b7f14f0\r\nContent-Disposition: form-data; name=\"StateProvinceId\"\r\n\r\n0\r\n------geckoformboundary103e049c75d8ba8170e70bd1b7f14f0\r\nContent-Disposition: form-data; name=\"ZipPostalCode\"\r\n\r\n627501\r\n------geckoformboundary103e049c75d8ba8170e70bd1b7f14f0\r\nContent-Disposition: form-data; name=\"termsofservice\"\r\n\r\non\r\n------geckoformboundary103e049c75d8ba8170e70bd1b7f14f0\r\nContent-Disposition: form-data; name=\"checkout\"\r\n\r\ncheckout\r\n------geckoformboundary103e049c75d8ba8170e70bd1b7f14f0--\r\n",
        { headers: {
  "Content-Type": "multipart/form-data; boundary=----geckoformboundary103e049c75d8ba8170e70bd1b7f14f0",
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Content-Length": "1484",
  "Origin": "https://demowebshop.tricentis.com",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/cart",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Priority": "u=0, i"
}, jar: jar, }
    );

        console.log("Request: Request 20 — /cart");
        console.log("Status:", res_19.status);
        console.log("Body:", res_19.body);

        aggregateResponseTime.add(res_19.timings.duration);

        if (res_19.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_19, {
            "Request 20 — /cart status 302": (r) => r.status === 302,
            "Request 20 — /cart response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 21 — /checkout ──
        let res_20 = (() => {
            const __url_20 = `https://demowebshop.tricentis.com/checkout`;
            const __cacheHeaders_20 = getCacheHeaders(__url_20);
            const __mergedHeaders_20 = Object.assign({}, {
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Referer": "https://demowebshop.tricentis.com/cart",
  "Connection": "keep-alive",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Priority": "u=0, i"
}, __cacheHeaders_20);
            const __response_20 = http.get(__url_20, {
                headers: __mergedHeaders_20,
                jar: jar,
            });
            storeCacheEntry(__url_20, __response_20);
            if (__response_20.status === 304 && __cache[__url_20]) {
                const __cached_20 = __cache[__url_20];
                return Object.assign({}, __response_20, {
                    body: __cached_20.body,
                    status: 200,
                    originalStatus: 304,
                    isFromCache: true,
                    json: function (selector) {
                        try {
                            const parsed = JSON.parse(__cached_20.body);
                            if (!selector) return parsed;
                            return selector.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), parsed);
                        } catch (e) {
                            return undefined;
                        }
                    }
                });
            }
            return __response_20;
        })();

        console.log("Request: Request 21 — /checkout");
        console.log("Status:", res_20.status);
        console.log("Body:", res_20.body);

        aggregateResponseTime.add(res_20.timings.duration);

        if (res_20.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_20, {
            "Request 21 — /checkout status 302": (r) => r.status === 302,
            "Request 21 — /checkout response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 22 — /onepagecheckout ──
        let res_21 = (() => {
            const __url_21 = `https://demowebshop.tricentis.com/onepagecheckout`;
            const __cacheHeaders_21 = getCacheHeaders(__url_21);
            const __mergedHeaders_21 = Object.assign({}, {
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Referer": "https://demowebshop.tricentis.com/cart",
  "Connection": "keep-alive",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Priority": "u=0, i"
}, __cacheHeaders_21);
            const __response_21 = http.get(__url_21, {
                headers: __mergedHeaders_21,
                jar: jar,
            });
            storeCacheEntry(__url_21, __response_21);
            if (__response_21.status === 304 && __cache[__url_21]) {
                const __cached_21 = __cache[__url_21];
                return Object.assign({}, __response_21, {
                    body: __cached_21.body,
                    status: 200,
                    originalStatus: 304,
                    isFromCache: true,
                    json: function (selector) {
                        try {
                            const parsed = JSON.parse(__cached_21.body);
                            if (!selector) return parsed;
                            return selector.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), parsed);
                        } catch (e) {
                            return undefined;
                        }
                    }
                });
            }
            return __response_21;
        })();

        console.log("Request: Request 22 — /onepagecheckout");
        console.log("Status:", res_21.status);
        console.log("Body:", res_21.body);

        aggregateResponseTime.add(res_21.timings.duration);

        if (res_21.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_21, {
            "Request 22 — /onepagecheckout status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 22 — /onepagecheckout response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 23 — /checkout/OpcSaveBilling/ ──
        let res_22 = http.request(
        "POST",
        `https://demowebshop.tricentis.com/checkout/OpcSaveBilling/`,
        "billing_address_id=4977310&BillingNewAddress.Id=0&BillingNewAddress.FirstName=Esakkiappan+&BillingNewAddress.LastName=Nambi&BillingNewAddress.Email=esakki3124%40gmail.com&BillingNewAddress.Company=&BillingNewAddress.CountryId=0&BillingNewAddress.StateProvinceId=0&BillingNewAddress.City=&BillingNewAddress.Address1=&BillingNewAddress.Address2=&BillingNewAddress.ZipPostalCode=&BillingNewAddress.PhoneNumber=&BillingNewAddress.FaxNumber=",
        { headers: {
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "X-Requested-With": "XMLHttpRequest",
  "Content-Length": "436",
  "Origin": "https://demowebshop.tricentis.com",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/onepagecheckout",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Priority": "u=0"
}, jar: jar, }
    );

        console.log("Request: Request 23 — /checkout/OpcSaveBilling/");
        console.log("Status:", res_22.status);
        console.log("Body:", res_22.body);

        aggregateResponseTime.add(res_22.timings.duration);

        if (res_22.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_22, {
            "Request 23 — /checkout/OpcSaveBilling/ status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 23 — /checkout/OpcSaveBilling/ response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 24 — /checkout/OpcSaveShipping/ ──
        let res_23 = http.request(
        "POST",
        `https://demowebshop.tricentis.com/checkout/OpcSaveShipping/`,
        "shipping_address_id=4977310&ShippingNewAddress.Id=0&ShippingNewAddress.FirstName=Esakkiappan+&ShippingNewAddress.LastName=Nambi&ShippingNewAddress.Email=esakki3124%40gmail.com&ShippingNewAddress.Company=&ShippingNewAddress.CountryId=0&ShippingNewAddress.StateProvinceId=0&ShippingNewAddress.City=&ShippingNewAddress.Address1=&ShippingNewAddress.Address2=&ShippingNewAddress.ZipPostalCode=&ShippingNewAddress.PhoneNumber=&ShippingNewAddress.FaxNumber=&PickUpInStore=true&PickUpInStore=false",
        { headers: {
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "X-Requested-With": "XMLHttpRequest",
  "Content-Length": "489",
  "Origin": "https://demowebshop.tricentis.com",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/onepagecheckout",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Priority": "u=0"
}, jar: jar, }
    );

        console.log("Request: Request 24 — /checkout/OpcSaveShipping/");
        console.log("Status:", res_23.status);
        console.log("Body:", res_23.body);

        aggregateResponseTime.add(res_23.timings.duration);

        if (res_23.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_23, {
            "Request 24 — /checkout/OpcSaveShipping/ status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 24 — /checkout/OpcSaveShipping/ response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 25 — /checkout/OpcSavePaymentMethod/ ──
        let res_24 = http.request(
        "POST",
        `https://demowebshop.tricentis.com/checkout/OpcSavePaymentMethod/`,
        "paymentmethod=Payments.CashOnDelivery",
        { headers: {
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "X-Requested-With": "XMLHttpRequest",
  "Content-Length": "37",
  "Origin": "https://demowebshop.tricentis.com",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/onepagecheckout",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Priority": "u=0"
}, jar: jar, }
    );

        console.log("Request: Request 25 — /checkout/OpcSavePaymentMethod/");
        console.log("Status:", res_24.status);
        console.log("Body:", res_24.body);

        aggregateResponseTime.add(res_24.timings.duration);

        if (res_24.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_24, {
            "Request 25 — /checkout/OpcSavePaymentMethod/ status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 25 — /checkout/OpcSavePaymentMethod/ response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 26 — /checkout/OpcSavePaymentInfo/ ──
        let res_25 = http.request(
        "POST",
        `https://demowebshop.tricentis.com/checkout/OpcSavePaymentInfo/`,
        "{}",
        { headers: {
  "Content-Type": "application/json",
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "X-Requested-With": "XMLHttpRequest",
  "Origin": "https://demowebshop.tricentis.com",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/onepagecheckout",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Priority": "u=0",
  "Content-Length": "0"
}, jar: jar, }
    );

        console.log("Request: Request 26 — /checkout/OpcSavePaymentInfo/");
        console.log("Status:", res_25.status);
        console.log("Body:", res_25.body);

        aggregateResponseTime.add(res_25.timings.duration);

        if (res_25.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_25, {
            "Request 26 — /checkout/OpcSavePaymentInfo/ status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 26 — /checkout/OpcSavePaymentInfo/ response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 27 — /checkout/OpcConfirmOrder/ ──
        let res_26 = http.request(
        "POST",
        `https://demowebshop.tricentis.com/checkout/OpcConfirmOrder/`,
        "{}",
        { headers: {
  "Content-Type": "application/json",
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "X-Requested-With": "XMLHttpRequest",
  "Origin": "https://demowebshop.tricentis.com",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/onepagecheckout",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Priority": "u=0",
  "Content-Length": "0"
}, jar: jar, }
    );

        console.log("Request: Request 27 — /checkout/OpcConfirmOrder/");
        console.log("Status:", res_26.status);
        console.log("Body:", res_26.body);

        aggregateResponseTime.add(res_26.timings.duration);

        if (res_26.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_26, {
            "Request 27 — /checkout/OpcConfirmOrder/ status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 27 — /checkout/OpcConfirmOrder/ response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 28 — /checkout/completed/ ──
        let res_27 = (() => {
            const __url_27 = `https://demowebshop.tricentis.com/checkout/completed/`;
            const __cacheHeaders_27 = getCacheHeaders(__url_27);
            const __mergedHeaders_27 = Object.assign({}, {
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/onepagecheckout",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Priority": "u=0, i"
}, __cacheHeaders_27);
            const __response_27 = http.get(__url_27, {
                headers: __mergedHeaders_27,
                jar: jar,
            });
            storeCacheEntry(__url_27, __response_27);
            if (__response_27.status === 304 && __cache[__url_27]) {
                const __cached_27 = __cache[__url_27];
                return Object.assign({}, __response_27, {
                    body: __cached_27.body,
                    status: 200,
                    originalStatus: 304,
                    isFromCache: true,
                    json: function (selector) {
                        try {
                            const parsed = JSON.parse(__cached_27.body);
                            if (!selector) return parsed;
                            return selector.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), parsed);
                        } catch (e) {
                            return undefined;
                        }
                    }
                });
            }
            return __response_27;
        })();

        console.log("Request: Request 28 — /checkout/completed/");
        console.log("Status:", res_27.status);
        console.log("Body:", res_27.body);

        aggregateResponseTime.add(res_27.timings.duration);

        if (res_27.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_27, {
            "Request 28 — /checkout/completed/ status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 28 — /checkout/completed/ response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 29 — / ──
        let res_28 = (() => {
            const __url_28 = `https://demowebshop.tricentis.com/`;
            const __cacheHeaders_28 = getCacheHeaders(__url_28);
            const __mergedHeaders_28 = Object.assign({}, {
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/checkout/completed/",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Priority": "u=0, i"
}, __cacheHeaders_28);
            const __response_28 = http.get(__url_28, {
                headers: __mergedHeaders_28,
                jar: jar,
            });
            storeCacheEntry(__url_28, __response_28);
            if (__response_28.status === 304 && __cache[__url_28]) {
                const __cached_28 = __cache[__url_28];
                return Object.assign({}, __response_28, {
                    body: __cached_28.body,
                    status: 200,
                    originalStatus: 304,
                    isFromCache: true,
                    json: function (selector) {
                        try {
                            const parsed = JSON.parse(__cached_28.body);
                            if (!selector) return parsed;
                            return selector.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), parsed);
                        } catch (e) {
                            return undefined;
                        }
                    }
                });
            }
            return __response_28;
        })();

        console.log("Request: Request 29 — /");
        console.log("Status:", res_28.status);
        console.log("Body:", res_28.body);

        aggregateResponseTime.add(res_28.timings.duration);

        if (res_28.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_28, {
            "Request 29 — / status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 29 — / response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 30 — /logout ──
        let res_29 = (() => {
            const __url_29 = `https://demowebshop.tricentis.com/logout`;
            const __cacheHeaders_29 = getCacheHeaders(__url_29);
            const __mergedHeaders_29 = Object.assign({}, {
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Connection": "keep-alive",
  "Referer": "https://demowebshop.tricentis.com/",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn; NOPCOMMERCE.AUTH=7CDE6A4233D456342E45E124C179CA92160E366591D96AFFF609895A786288029C31943B58481E8CCF6D74DFC2098958D75979E730E45B62F859C52F3906F23AC0FF661D459C57E0FE5A473DD30BCAB8A5A2923017C7D814B33EA9C49CFF4248A41EB5751AFEFA1AD4992BCD586B75D62EF1079286ED16B851FBF5893A8C0914D3F35666793BC676592C76EE7A835C83AA7D3E0A57023DFAAB5A70A4B9E80E55",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Priority": "u=0, i"
}, __cacheHeaders_29);
            const __response_29 = http.get(__url_29, {
                headers: __mergedHeaders_29,
                jar: jar,
            });
            storeCacheEntry(__url_29, __response_29);
            if (__response_29.status === 304 && __cache[__url_29]) {
                const __cached_29 = __cache[__url_29];
                return Object.assign({}, __response_29, {
                    body: __cached_29.body,
                    status: 200,
                    originalStatus: 304,
                    isFromCache: true,
                    json: function (selector) {
                        try {
                            const parsed = JSON.parse(__cached_29.body);
                            if (!selector) return parsed;
                            return selector.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), parsed);
                        } catch (e) {
                            return undefined;
                        }
                    }
                });
            }
            return __response_29;
        })();

        console.log("Request: Request 30 — /logout");
        console.log("Status:", res_29.status);
        console.log("Body:", res_29.body);

        aggregateResponseTime.add(res_29.timings.duration);

        if (res_29.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_29, {
            "Request 30 — /logout status 302": (r) => r.status === 302,
            "Request 30 — /logout response time < 2000ms": (r) => r.timings.duration <= 2000
        });

        // ── Request 31 — / ──
        let res_30 = (() => {
            const __url_30 = `https://demowebshop.tricentis.com/`;
            const __cacheHeaders_30 = getCacheHeaders(__url_30);
            const __mergedHeaders_30 = Object.assign({}, {
  "Host": "demowebshop.tricentis.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Referer": "https://demowebshop.tricentis.com/",
  "Connection": "keep-alive",
  "Cookie": "Nop.customer=aa7e3297-d0fc-42ad-90fb-f2a4873a501b; __utma=78382081.1263267083.1787461862.1787461862.1791867360.2; __utmz=78382081.1787461862.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); NopCommerce.RecentlyViewedProducts=RecentlyViewedProductIds=72&RecentlyViewedProductIds=80&RecentlyViewedProductIds=2&RecentlyViewedProductIds=1; ARRAffinity=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ARRAffinitySameSite=f4edb6097d47b618727013498965259efd35f8883f487e535625e82c6dc8570c; ASP.NET_SessionId=uojwixf3twnacgitwy1ig3dn",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Priority": "u=0, i"
}, __cacheHeaders_30);
            const __response_30 = http.get(__url_30, {
                headers: __mergedHeaders_30,
                jar: jar,
            });
            storeCacheEntry(__url_30, __response_30);
            if (__response_30.status === 304 && __cache[__url_30]) {
                const __cached_30 = __cache[__url_30];
                return Object.assign({}, __response_30, {
                    body: __cached_30.body,
                    status: 200,
                    originalStatus: 304,
                    isFromCache: true,
                    json: function (selector) {
                        try {
                            const parsed = JSON.parse(__cached_30.body);
                            if (!selector) return parsed;
                            return selector.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), parsed);
                        } catch (e) {
                            return undefined;
                        }
                    }
                });
            }
            return __response_30;
        })();

        console.log("Request: Request 31 — /");
        console.log("Status:", res_30.status);
        console.log("Body:", res_30.body);

        aggregateResponseTime.add(res_30.timings.duration);

        if (res_30.status >= 400) {
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        } else {
            aggregateFailureRate.add(false);
        }
        sleep(1000 / 1000);

        check(res_30, {
            "Request 31 — / status 200": (r) => r.status === 200 || r.status === 304 || r.isFromCache === true,
            "Request 31 — / response time < 2000ms": (r) => r.timings.duration <= 2000
        });

    }
}
