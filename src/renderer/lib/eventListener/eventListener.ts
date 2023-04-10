const EVENT_LISTENERS: any = []

const eventListener = {
	on: (name: string, listener: Function) => {
		if (!EVENT_LISTENERS[name]) {
			EVENT_LISTENERS[name] = []
		}

		EVENT_LISTENERS[name].push(listener)

		return {
			remove: () => {
				if (!EVENT_LISTENERS[name]) {
					return
				}

				EVENT_LISTENERS[name] = EVENT_LISTENERS[name].filter((filteredListener: Function) => filteredListener !== listener)
			}
		}
	},
	emit: (name: string, data?: any) => {
		if (!EVENT_LISTENERS[name]) {
			return
		}

		EVENT_LISTENERS[name].forEach((listener: Function) => {
			listener(data)
		})
	}
}

export default eventListener
