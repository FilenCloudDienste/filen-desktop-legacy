const cacheMap = new Map()

module.exports = {
    has: (key) => {
        return cacheMap.has(key)
    },
    get: (key) => {
        if(cacheMap.has(key)){
            return cacheMap.get(key)
        }

        return null
    },
    set: (key, value) => {
        cacheMap.set(key, value)

        return true
    },
    delete: (key) => {
        if(cacheMap.has(key)){
            cacheMap.delete(key)
        }

        return true
    },
    cache: cacheMap
}