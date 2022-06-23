import React, { memo } from "react"
import { Button } from "@chakra-ui/react"

export const NormalButton = memo((...props) => {
    props = props[0]
    
    return (
        <Button {...props}>
            {props.children}
        </Button>
    )
})