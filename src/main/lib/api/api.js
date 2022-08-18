const { app } = require("electron")
const https = require("https")
const log = require("electron-log")

const retryAPIRequestTimeout = 1000
const maxRetryAPIRequest = 1024

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
                agent: new https.Agent({
                    keepAlive: true
                }),
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

                let res = ""

                response.on("error", (err) => {
                    log.error(err)

                    res = ""

                    return setTimeout(doRequest, retryAPIRequestTimeout)
                })

                response.on("data", (chunk) => {
                    res += chunk
                })

                response.on("end", () => {
                    try{
                        const obj = JSON.parse(res)

                        res = ""

                        if(typeof obj.message == "string"){
                            if(obj.message.toLowerCase().indexOf("invalid api key") !== -1){
                                app.quit()

                                return
                            }
                        }

                        return resolve(obj)
                    }
                    catch(e){
                        log.error(e)

                        res = ""
    
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

            /*request({
                method: method.toUpperCase(),
                url: "https://api.filen.io" + endpoint,
                timeout,
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "filen-desktop"
                },
                family: 4,
                body: JSON.stringify(data)
            }, (err, response, body) => {
                if(err){
                    log.error(err)

                    return setTimeout(doRequest, retryAPIRequestTimeout)
                }

                if(response.statusCode !== 200){
                    log.error(new Error("API response " + response.statusCode + ", method: " + method.toUpperCase() + ", endpoint: " + endpoint + ", data: " + JSON.stringify(data)))

                    return setTimeout(doRequest, retryAPIRequestTimeout) 
                }

                try{
                    const obj = JSON.parse(body)

                    if(typeof obj.message == "string"){
                        if(obj.message.toLowerCase().indexOf("invalid api key") !== -1){
                            app.quit()

                            return
                        }
                    }

                    return resolve(obj)
                }
                catch(e){
                    log.error(e)

                    return setTimeout(doRequest, retryAPIRequestTimeout)
                }
            })*/
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