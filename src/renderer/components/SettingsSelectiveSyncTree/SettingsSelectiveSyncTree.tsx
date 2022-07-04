import React, { memo, useState, useCallback, useEffect } from "react"
import { Flex, Text, Box, Checkbox, Image } from "@chakra-ui/react"
import { AiOutlineCaretRight, AiOutlineCaretDown } from "react-icons/ai"
import useDb from "../../lib/hooks/useDb"
import db from "../../lib/db"
import { IoFolder, IoFolderOpen } from "react-icons/io5"
import { BsFileEarmarkFill } from "react-icons/bs"
import ipc from "../../lib/ipc"
import getColor from "../../styles/colors"

const log = window.require("electron-log")

interface TreeItemProps {
    darkMode: boolean,
    lang: string,
    platform: string,
    item: any,
    location: any,
    excluded: any
}

interface TreeProps {
    darkMode: boolean,
    lang: string,
    platform: string,
    data: any
    location: any
}

const TreeItem = memo(({ darkMode, lang, platform, item, location, excluded }: TreeItemProps) => {
    const [isOpen, setIsOpen] = useState<boolean>(false)
    const [itemIcon, setItemIcon] = useState<string | undefined>(undefined)

    const isItemExcluded = useCallback(() => {
        if(typeof excluded[item.path] !== "undefined"){
            return true
        }

        for(const path in excluded){
            if(item.path.indexOf(item.type == "folder" ? path + "/" : path) !== -1){
                return true
            }
        }

        return false
    }, [item, excluded])

    const isParentExcluded = useCallback(() => {
        for(const path in excluded){
            if(item.path.indexOf(item.type == "folder" ? path + "/" : path) !== -1 && item.path !== path){
                return true
            }
        }

        return false
    }, [item, excluded])

    const onToggleExcluded = async () => {
        if(isParentExcluded()){
            return false
        }

        const isExcluded = typeof excluded[item.path] !== "undefined"

        try{
            let currentExcluded = await db.get("selectiveSync:remote:" + location.uuid)

            if(currentExcluded == null){
                currentExcluded = {}
            }

            if(isExcluded){
                delete currentExcluded[item.path]
            }
            else{
                currentExcluded[item.path] = true
            }

            await db.set("selectiveSync:remote:" + location.uuid, currentExcluded)

            console.log(currentExcluded)
        }
        catch(e){
            log.error(e)
        }
    }

    const onToggleOpen = () => {
        if(item.children.length == 0){
            return false
        }

        setIsOpen(!isOpen)
    }

    useEffect(() => {
        ipc.getFileIconName(item.name).then((icon) => {
            if(typeof icon == "string" && icon.indexOf("data:") !== -1){
                setItemIcon(icon)
            }
        }).catch(log.error)
    }, [])

    return (
        <Box 
            width="100%"
            height="auto" 
            key={item.path} 
            cursor="default"
        >
            <Flex 
                flexDirection="row" 
                alignItems="center"
            >
                <Flex 
                    flexDirection="row" 
                    alignItems="center" 
                    width="auto"
                >
                    <Checkbox 
                        isChecked={!isItemExcluded()} 
                        _focus={{ outline: "none" }} 
                        outline="none" 
                        _active={{ outline: "none" }} 
                        onChange={onToggleExcluded} 
                    />
                </Flex>
                <Flex 
                    flexDirection="row" 
                    alignItems="center" 
                    width="auto" 
                    cursor={item.type == "folder" ? "pointer" : "default"} 
                    onClick={onToggleOpen} 
                    marginLeft="8px"
                >
                    {
                        item.type == "folder" ? (
                            isOpen ? (
                                <>
                                    <AiOutlineCaretDown color="white" />
                                    <IoFolderOpen 
                                        color={platform == "mac" ? "#3ea0d5" : "#ffd04c"} 
                                        style={{
                                            marginLeft: 4
                                        }} 
                                    />
                                </>
                            ) : (
                                <>
                                    <AiOutlineCaretRight color="white" />
                                    <IoFolder 
                                        color={platform == "mac" ? "#3ea0d5" : "#ffd04c"} 
                                        style={{
                                            marginLeft: 4
                                        }} 
                                    />
                                </>
                            )
                        ) : (
                            <>
                                {
                                    typeof itemIcon == "string" ? (
                                        <Image 
                                            src={itemIcon}
                                            width="16px"
                                            height="16px" 
                                        />
                                    ) : (
                                        <BsFileEarmarkFill color={getColor(platform, darkMode, "textPrimary")} />
                                    )
                                }
                            </>
                        )
                    }
                </Flex>
                <Flex 
                    flexDirection="row" 
                    alignItems="center" 
                    width="auto" 
                    cursor={item.type == "folder" ? "pointer" : "default"} 
                    onClick={onToggleOpen} 
                    marginLeft="8px"
                >
                    <Text color="white">{item.name}</Text>
                </Flex>
            </Flex>
            <Box 
                width="100%" 
                height="auto" 
                display={isOpen ? "block" : "none"} 
                paddingLeft="30px"
            >
                {
                    item.children.length > 0 && (
                        <Tree 
                            darkMode={darkMode} 
                            lang={lang} 
                            platform={platform} 
                            data={item.children} 
                            location={location} 
                        />
                    )
                }
            </Box>
        </Box>
    )
})

const Tree = memo(({ darkMode, lang, platform, data, location }: TreeProps) => {
    const excluded: any = useDb("selectiveSync:remote:" + location.uuid, {})

    return data.map((item: any) => {
        return (
            <TreeItem 
                darkMode={darkMode} 
                lang={lang} 
                platform={platform} 
                key={item.path} 
                item={item} 
                location={location} 
                excluded={excluded} 
            />
        )
    })
})

export default Tree