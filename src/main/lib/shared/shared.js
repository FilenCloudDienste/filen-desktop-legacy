const shared = {}

const set = (key, value) => {
    shared[key] = value

    return true
}

const get = (key) => {
    if(!shared[key]){
        return undefined
    }

    return shared[key]
}

const remove = (key) => {
    if(!shared[key]){
        return true
    }

    shared[key] = undefined

    return true
}

module.exports = {
    set,
    get,
    remove,
    shared
}