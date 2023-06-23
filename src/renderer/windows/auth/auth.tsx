import React, { memo, useState, useEffect, useRef } from "react"
import Titlebar from "../../components/Titlebar"
import { Image, Flex, Input, Link, Button, Spinner } from "@chakra-ui/react"
import useDarkMode from "../../lib/hooks/useDarkMode"
// @ts-ignore
import DarkLogo from "../../../../src/assets/images/dark_logo.png"
// @ts-ignore
import LightLogo from "../../../../src/assets/images/light_logo.png"
import { i18n } from "../../lib/i18n"
import useLang from "../../lib/hooks/useLang"
import usePlatform from "../../lib/hooks/usePlatform"
import { login, authInfo, userInfo } from "../../lib/api"
import db from "../../lib/db"
import { showToast } from "../../components/Toast"
import ipc from "../../lib/ipc"
import colors from "../../styles/colors"
import Container from "../../components/Container"
import { generatePasswordAndMasterKeysBasedOnAuthVersion } from "../../lib/crypto"

const { shell, ipcRenderer } = window.require("electron")
const log = window.require("electron-log")

const AuthWindow = memo(({ windowId }: { windowId: string }) => {
	const darkMode = useDarkMode()
	const lang = useLang()
	const platform = usePlatform()

	const [email, setEmail] = useState<string>("")
	const [password, setPassword] = useState<string>("")
	const [twoFactorCode, setTwoFactorCode] = useState<string>("")
	const [showTwoFactor, setShowTwoFactor] = useState<boolean>(false)
	const [isLoading, setIsLoading] = useState<boolean>(false)
	const passwordFieldRef = useRef<any>()

	const doLogin = async () => {
		let emailToSend = email.trim()
		let passwordToSend = password.trim()
		let twoFactorCodeToSend = twoFactorCode.trim()

		if (twoFactorCodeToSend.length == 0) {
			twoFactorCodeToSend = "XXXXXX"
		}

		if (!emailToSend || !passwordToSend) {
			setEmail("")
			setPassword("")
			setTwoFactorCode("")

			return showToast({ message: i18n(lang, "loginInvalidEmailOrPassword"), status: "error" })
		}

		setIsLoading(true)

		try {
			var authInfoResponse = await authInfo({ email: emailToSend })
		} catch (e: any) {
			if (e.toString() == "Invalid email.") {
				setEmail("")
				setPassword("")
				setTwoFactorCode("")
				setIsLoading(false)

				return showToast({ message: i18n(lang, "loginInvalidEmail"), status: "error" })
			}

			log.error("Could not get auth info for " + emailToSend)
			log.error(e)

			setIsLoading(false)

			return showToast({ message: e.toString(), status: "error" })
		}

		const authVersion: number = authInfoResponse.authVersion
		const salt: string = authInfoResponse.salt
		let masterKeys: string = ""

		try {
			const { derivedPassword, derivedMasterKeys } = await generatePasswordAndMasterKeysBasedOnAuthVersion({
				rawPassword: passwordToSend,
				authVersion,
				salt
			})

			passwordToSend = derivedPassword
			masterKeys = derivedMasterKeys
		} catch (e: any) {
			log.error("Could not derive password and master keys")
			log.error(e)

			setIsLoading(false)

			return showToast({ message: e.toString(), status: "error" })
		}

		try {
			var loginResponse = await login({
				email: emailToSend,
				password: passwordToSend,
				twoFactorCode: twoFactorCodeToSend,
				authVersion
			})
		} catch (e: any) {
			setIsLoading(false)

			if (e.toString().toLowerCase().indexOf("enter_2fa") !== -1) {
				setTwoFactorCode("")
				setShowTwoFactor(true)

				return
			} else if (e.toString().toLowerCase().indexOf("email_or_password_wrong") !== -1) {
				setPassword("")
				setTwoFactorCode("")

				return showToast({ message: i18n(lang, "loginWrongEmailOrPassword"), status: "error" })
			} else if (e.toString().toLowerCase().indexOf("wrong_2fa") !== -1) {
				setTwoFactorCode("")
				setShowTwoFactor(true)

				return showToast({ message: i18n(lang, "invalidTwoFactorKey"), status: "error" })
			} else {
				return showToast({ message: e.toString(), status: "error" })
			}
		}

		try {
			var userInfoResponse: any = await userInfo(loginResponse.apiKey)
		} catch (e: any) {
			log.error("Could not get user info for " + emailToSend)
			log.error(e)

			setIsLoading(false)

			return showToast({ message: e.toString(), status: "error" })
		}

		try {
			await Promise.all([
				db.set("apiKey", loginResponse.apiKey),
				db.set("email", emailToSend),
				db.set("userId", userInfoResponse.id),
				db.set("masterKeys", [masterKeys]),
				db.set("authVersion", authVersion),
				db.set("isLoggedIn", true)
			])
		} catch (e: any) {
			log.error("Could not save login values to DB")
			log.error(e)

			setIsLoading(false)

			return showToast({ message: e.toString(), status: "error" })
		}

		try {
			await ipc.loginDone()

			setIsLoading(false)
		} catch (e: any) {
			log.error("Login done error")
			log.error(e)

			setIsLoading(false)

			return showToast({ message: e.toString(), status: "error" })
		}

		return true
	}

	useEffect(() => {
		ipcRenderer.send("window-ready", windowId)
	}, [])

	return (
		<Container>
			<Titlebar
				darkMode={darkMode}
				lang={lang}
				platform={platform}
				title={i18n(lang, "titlebarLogin")}
			/>
			<Flex
				userSelect="none"
				flexDirection="column"
				justifyContent="center"
				alignItems="center"
				width="100%"
				height="100%"
				padding="30px"
			>
				<Image
					src={darkMode ? LightLogo : DarkLogo}
					userSelect="none"
					width="75px"
					marginBottom="40px"
				/>
				{showTwoFactor ? (
					<>
						<Input
							type="text"
							value={twoFactorCode}
							onChange={event => setTwoFactorCode(event.target.value)}
							placeholder={i18n(lang, "loginTwoFactorCodePlaceholder")}
							style={{
								border: "none",
								backgroundColor: darkMode ? "#171717" : "lightgray",
								color: "gray"
							}}
							onKeyDown={e => {
								if (e.key == "Enter") {
									doLogin()
								}
							}}
							_placeholder={{
								color: "gray"
							}}
						/>
						<Link
							color="#0A84FF"
							textDecoration="none"
							_hover={{
								textDecoration: "none"
							}}
							marginTop="15px"
							marginBottom="5px"
							onClick={() => {
								setTwoFactorCode("")
								setShowTwoFactor(false)
							}}
						>
							{i18n(lang, "cancel")}
						</Link>
					</>
				) : (
					<>
						<Input
							type="email"
							value={email}
							onChange={event => setEmail(event.target.value)}
							placeholder={i18n(lang, "loginEmailPlaceholder")}
							style={{
								marginBottom: 10,
								border: "none",
								backgroundColor: darkMode ? "#171717" : "lightgray",
								color: "gray"
							}}
							_placeholder={{
								color: "gray"
							}}
							onKeyDown={e => {
								if (e.key == "Enter") {
									passwordFieldRef.current?.focus()
								}
							}}
						/>
						<Input
							type="password"
							value={password}
							onChange={event => setPassword(event.target.value)}
							placeholder={i18n(lang, "loginPasswordPlaceholder")}
							ref={passwordFieldRef}
							style={{
								border: "none",
								backgroundColor: darkMode ? "#171717" : "lightgray",
								color: "gray"
							}}
							_placeholder={{
								color: "gray"
							}}
							onKeyDown={e => {
								if (e.key == "Enter") {
									doLogin()
								}
							}}
						/>
					</>
				)}
				<Button
					onClick={() => doLogin()}
					userSelect="none"
					backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
					_hover={{
						backgroundColor: colors(platform, darkMode, "backgroundSecondary")
					}}
					_focus={{ boxShadow: "none" }}
					style={{
						marginTop: 20,
						marginBottom: 30
					}}
					disabled={isLoading}
				>
					{isLoading ? (
						<Spinner
							width="20px"
							height="20px"
							color={colors(platform, darkMode, "textPrimary")}
						/>
					) : (
						i18n(lang, "loginBtn")
					)}
				</Button>
				{!showTwoFactor && (
					<>
						<Link
							color="#0A84FF"
							textDecoration="none"
							_hover={{
								textDecoration: "none"
							}}
							onClick={() => shell.openExternal("https://drive.filen.io/forgot-password")}
						>
							{i18n(lang, "forgotPasswordBtn")}
						</Link>
						<Link
							color="#0A84FF"
							textDecoration="none"
							_hover={{
								textDecoration: "none"
							}}
							onClick={() => shell.openExternal("https://drive.filen.io/register")}
						>
							{i18n(lang, "createAccountBtn")}
						</Link>
					</>
				)}
			</Flex>
		</Container>
	)
})

export default AuthWindow
