import React, { memo, useState, useCallback, useEffect } from "react"
import Titlebar from "../../components/Titlebar"
import { Image, Flex, Input, Link, Button, Spinner } from "@chakra-ui/react"
import useDarkMode from "../../lib/hooks/useDarkMode"
import DarkLogo from "../../../../src/assets/images/dark_logo.png"
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

const { shell, ipcRenderer } = window.require("electron")
const log = window.require("electron-log")

const AuthWindow = memo(({ windowId }) => {
    const darkMode = useDarkMode()
    const lang = useLang()
    const platform = usePlatform()

    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [twoFactorCode, setTwoFactorCode] = useState("")
    const [showTwoFactor, setShowTwoFactor] = useState(false)
    const [isLoading, setIsLoading] = useState(false)

    const doLogin = useCallback(async () => {
        let emailToSend = email.trim()
        let passwordToSend = password.trim()
        let twoFactorCodeToSend = twoFactorCode.trim()

        if(twoFactorCodeToSend.length == 0){
            twoFactorCodeToSend = "XXXXXX"
        }

        if(!emailToSend || !passwordToSend){
            setEmail("")
            setPassword("")
            setTwoFactorCode("")

            return showToast({ message: i18n(lang, "loginInvalidEmailOrPassword"), status: "error" })
        }

        setIsLoading(true)

        try{
            var authInfoResponse = await authInfo({ email: emailToSend })
        }
        catch(e){
            if(e.toString() == "Invalid email."){
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

        const authVersion = authInfoResponse.authVersion
        const salt = authInfoResponse.salt
        let masterKeys = ""

        try{
            const { derivedPassword, derivedMasterKeys } = await ipc.generatePasswordAndMasterKeysBasedOnAuthVersion({ rawPassword: passwordToSend, authVersion, salt })

            passwordToSend = derivedPassword
            masterKeys = derivedMasterKeys
        }
        catch(e){
            log.error("Could not derive password and master keys")
            log.error(e)

            setIsLoading(false)

            return showToast({ message: e.toString(), status: "error" })
        }

        try{
            var loginResponse = await login({ email: emailToSend, password: passwordToSend, twoFactorCode: twoFactorCodeToSend })
        }
        catch(e){
            setIsLoading(false)

            if(e.toString() == "Please enter your Two Factor Authentication code."){
                setTwoFactorCode("")
                setShowTwoFactor(true)
    
                return false
            }
            else if(e.toString() == "Invalid email."){
                setEmail("")
                setTwoFactorCode("")
    
                return showToast({ message: i18n(lang, "loginInvalidEmailOrPassword"), status: "error" })
            }
            else if(e.toString() == "Invalid password."){
                setPassword("")
                setTwoFactorCode("")
    
                return showToast({ message: i18n(lang, "loginInvalidEmailOrPassword"), status: "error" })
            }
            else if(e.toString() == "Account not yet activated."){
                setPassword("")
                setTwoFactorCode("")
    
                return showToast({ message: i18n(lang, "loginAccountNotYetActivated"), status: "error" })
            }
            else if(e.toString() == "Account not found."){
                setPassword("")
                setTwoFactorCode("")
    
                return showToast({ message: i18n(lang, "loginWrongEmailOrPassword"), status: "error" })
            }
            else if(e.toString() == "Email address or password wrong."){
                setPassword("")
                setTwoFactorCode("")
    
                return showToast({ message: i18n(lang, "loginWrongEmailOrPassword"), status: "error" })
            }
            else if(e.toString() == "Invalid Two Factor Authentication code." || e.toString() == "Invalid 2fa key"){
                setTwoFactorCode("")
                setShowTwoFactor(true)
    
                return showToast({ message: i18n(lang, "invalidTwoFactorKey"), status: "error" })
            }
            else{
                return showToast({ message: e.toString(), status: "error" })
            }
        }

        try{
            var userInfoResponse = await userInfo({ apiKey: loginResponse.apiKey })
        }
        catch(e){
            log.error("Could not get user info for " + emailToSend)
            log.error(e)

            setIsLoading(false)

            return showToast({ message: e.toString(), status: "error" })
        }

        try{
            await db.set("apiKey", loginResponse.apiKey)
            await db.set("email", emailToSend)
            await db.set("userId", userInfoResponse.id)
            await db.set("masterKeys", [masterKeys])
            await db.set("authVersion", authVersion)
            await db.set("isLoggedIn", true)
        }
        catch(e){
            log.error("Could not save login values to DB")
            log.error(e)

            setIsLoading(false)

            return showToast({ message: e.toString(), status: "error" })
        }

        try{
            await ipc.loginDone()

            setIsLoading(false)
        }
        catch(e){
            log.error("Login done error")
            log.error(e)

            setIsLoading(false)

            return showToast({ message: e.toString(), status: "error" })
        }

        return true
    })

    useEffect(() => {
        ipcRenderer.send("window-ready", windowId)
    }, [])

    return (
        <Container 
            darkMode={darkMode} 
            lang={lang} 
            platform={platform}
        >
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
                {
                    showTwoFactor ? (
                        <Input 
                        type="text" 
                        value={twoFactorCode} 
                        onChange={(event) => setTwoFactorCode(event.target.value)} 
                        placeholder={i18n(lang, "loginTwoFactorCodePlaceholder")} 
                        userSelect="none" 
                        style={{
                            border: "none",
                            backgroundColor: darkMode ? "#171717" : "lightgray",
                            color: "gray"
                        }} 
                        _placeholder={{
                            color: "gray"
                        }} />
                    ) : (
                        <>
                            <Input 
                                type="email" 
                                value={email} 
                                onChange={(event) => setEmail(event.target.value)} 
                                placeholder={i18n(lang, "loginEmailPlaceholder")} 
                                userSelect="none" 
                                style={{
                                    marginBottom: 10,
                                    border: "none",
                                    backgroundColor: darkMode ? "#171717" : "lightgray",
                                    color: "gray"
                                }} 
                                _placeholder={{
                                    color: "gray"
                                }} 
                            />
                            <Input 
                                type="password" 
                                value={password} 
                                onChange={(event) => setPassword(event.target.value)} 
                                placeholder={i18n(lang, "loginPasswordPlaceholder")} 
                                userSelect="none" 
                                style={{
                                    border: "none",
                                    backgroundColor: darkMode ? "#171717" : "lightgray",
                                    color: "gray"
                                }} 
                                _placeholder={{
                                    color: "gray"
                                }} 
                            />
                        </>
                    )
                }
                <Button 
                    onClick={() => doLogin()} 
                    userSelect="none" 
                    backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
                    _hover={{
                        backgroundColor: colors(platform, darkMode, "backgroundPrimary")
                    }}
                    _focus={{ boxShadow: "none" }} 
                    style={{
                        marginTop: 20,
                        marginBottom: 30
                    }}
                    disabled={isLoading}
                >
                    {
                        isLoading ? (
                            <Spinner 
                                width="20px"
                                height="20px"
                                color={colors(platform, darkMode, "textPrimary")}
                            />
                        ) : i18n(lang, "loginBtn")
                    }
                </Button>
                {
                    !showTwoFactor && (
                        <>
                            <Link 
                                color="#0A84FF" 
                                textDecoration="none" 
                                _hover={{
                                    textDecoration: "none"
                                }} 
                                onClick={() => shell.openExternal("https://filen.io/#forgot-password")}
                            >
                                Forgot password
                            </Link>
                            <Link 
                                color="#0A84FF" 
                                textDecoration="none" 
                                _hover={{
                                    textDecoration: "none"
                                }}
                                onClick={() => shell.openExternal("https://filen.io/#signup")}
                            >
                                Create account
                            </Link>
                        </>
                    )
                }
            </Flex>
        </Container>
    )
})

export default AuthWindow