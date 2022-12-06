const cacheMap = new Map<string, any>()

export const has = (key: string) => {
    return cacheMap.has(key)
}

export const get = (key: string) => {
    if(cacheMap.has(key)){
        return cacheMap.get(key)
    }

    return null
}

export const set =  (key: string, value: any) => {
    cacheMap.set(key, value)

    return true
}

export const del = (key: string) => {
    if(cacheMap.has(key)){
        cacheMap.delete(key)
    }

    return true
}

export const cache = cacheMap

const memoryCache = {
    has,
    get,
    set,
    delete: del,
    cache
}

export default memoryCache