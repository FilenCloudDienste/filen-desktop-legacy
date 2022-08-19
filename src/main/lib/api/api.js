const https = require("https")
const log = require("electron-log")

const retryAPIRequestTimeout = 1000
const maxRetryAPIRequest = 1024

const httpsAPIAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 8,
    timeout: 86400000
})

const apiRequest = ({ method = "POST", endpoint = "/v1/", data = {}, timeout = 500000 }) => {
    return new Promise((resolve, reject) => {
        let currentTries = 0

        const doRequest = async () => {
            if(currentTries >= maxRetryAPIRequest){
                return reject(new Error("Maximum retries (" + maxRetryAPIRequest + ") reached for API request: " + JSON.stringify({
                    method,
                    endpoint,
                    data,
                    timeout
                })))
            }

            currentTries += 1

            const req = https.request({
                method: method.toUpperCase(),
                hostname: "api.filen.io",
                path: endpoint,
                port: 443,
                agent: httpsAPIAgent,
                timeout: 86400000,
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "filen-desktop"
                }
            }, (response) => {
                if(response.statusCode !== 200){
                    log.error(new Error("API response " + response.statusCode + ", method: " + method.toUpperCase() + ", endpoint: " + endpoint + ", data: " + JSON.stringify(data)))

                    return setTimeout(doRequest, retryAPIRequestTimeout) 
                }

                const res = []

                response.on("data", (chunk) => {
                    res.push(chunk)
                })

                response.on("end", () => {
                    try{
                        const obj = JSON.parse(Buffer.concat(res).toString())

                        if(typeof obj.message == "string" && typeof obj.status == "boolean"){
                            if(!obj.status){
                                log.error(obj.message)
    
                                return reject(obj.message)
                            }
                        }

                        return resolve(obj)
                    }
                    catch(e){
                        log.error(e)
    
                        return reject(e)
                    }
                })
            })

            req.on("error", (err) => {
                log.error(err)

                return setTimeout(doRequest, retryAPIRequestTimeout)
            })

            req.write(JSON.stringify(data))
            req.end()
        }

        return doRequest()
    })
}

const acquireLock = ({ apiKey, id }) => {
    return new Promise((resolve, reject) => {
        apiRequest({
            method: "POST",
            endpoint: "/v1/lock/acquire",
            timeout: 10000,
            data: {
                apiKey,
                id
            }
        }).then((response) => {
            if(!response.status){
                return reject(response.message)
            }

            return resolve(response.data)
        }).catch(reject)
    })
}

const releaseLock = ({ apiKey, id }) => {
    return new Promise((resolve, reject) => {
        apiRequest({
            method: "POST",
            endpoint: "/v1/lock/release",
            timeout: 15000,
            data: {
                apiKey,
                id
            }
        }).then((response) => {
            if(!response.status){
                return reject(response.message)
            }

            return resolve(response.data)
        }).catch(reject)
    })
}

const holdLock = ({ apiKey, id }) => {
    return new Promise((resolve, reject) => {
        apiRequest({
            method: "POST",
            endpoint: "/v1/lock/hold",
            timeout: 10000,
            data: {
                apiKey,
                id
            }
        }).then((response) => {
            if(!response.status){
                return reject(response.message)
            }

            return resolve(response.data)
        }).catch(reject)
    })
}

module.exports = {
    apiRequest,
    acquireLock,
    holdLock,
    releaseLock
}