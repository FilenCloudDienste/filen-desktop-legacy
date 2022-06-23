import create from "zustand"
import { subscribeWithSelector } from "zustand/middleware"

export const useStore = create(subscribeWithSelector(set => ({
	
})))

export const waitForStateUpdate = (key, value) => {
	return new Promise((resolve, reject) => {
		let unsub = undefined
		let resolved = false

		const callback = () => {
			if(typeof unsub == "function"){
				unsub()
			}

			if(resolved){
				return false
			}

			resolved = true

			return resolve()
		}

		if(useStore.getState()[key] == value){
			return callback()
		}

		unsub = useStore.subscribe(state => state[key], () => {
			return callback()
		})

		useStore.setState({ [key]: value })
	})
}