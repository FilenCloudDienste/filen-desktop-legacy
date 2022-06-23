const EVENT_LISTENERS = []

const eventListener = {
    on: (name, listener) => {
        if(!EVENT_LISTENERS[name]){
            EVENT_LISTENERS[name] = []
        }
    
        EVENT_LISTENERS[name].push(listener)

        return {
            remove: () => {
                if(!EVENT_LISTENERS[name]){
                    return true
                }
        
                EVENT_LISTENERS[name] = EVENT_LISTENERS[name].filter((filteredListener) => filteredListener !== listener)
        
                return true
            }
        }
    },
    emit: (name, data) => {
        if(!EVENT_LISTENERS[name]){
            return false
        }

        EVENT_LISTENERS[name].forEach((listener) => {
            listener(data)
        })

        return true
    }
}

export default eventListener