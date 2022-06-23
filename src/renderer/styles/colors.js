const colors = {
    dark: {
        mac: {
            textPrimary: "white",
            textSecondary: "gray",
            backgroundPrimary: "rgba(28, 28, 28, 1)",
            backgroundSecondary: "rgba(47, 47, 47, 1)",
            borderPrimary: "rgba(77, 77, 77, 1)",
            buttonNonClicked: "#202020",
            buttonClicked: "#202020",
            titlebarBackgroundPrimary: "rgba(47, 47, 47, 1)",
            link: "#0A84FF",
            danger: "#FF3B31"
        },
        windows: {
            textPrimary: "white",
            textSecondary: "gray",
            backgroundPrimary: "rgba(28, 28, 28, 1)",
            backgroundSecondary: "rgba(47, 47, 47, 1)",
            borderPrimary: "rgba(77, 77, 77, 1)",
            buttonNonClicked: "#202020",
            buttonClicked: "#202020",
            titlebarBackgroundPrimary: "rgba(47, 47, 47, 1)",
            link: "#0A84FF",
            danger: "#FF3B31"
        },
        linux: {
            textPrimary: "white",
            textSecondary: "gray",
            backgroundPrimary: "rgba(28, 28, 28, 1)",
            backgroundSecondary: "rgba(47, 47, 47, 1)",
            borderPrimary: "rgba(77, 77, 77, 1)",
            buttonNonClicked: "#202020",
            buttonClicked: "#202020",
            titlebarBackgroundPrimary: "rgba(47, 47, 47, 1)",
            link: "#0A84FF",
            danger: "#FF3B31"
        }
    },
    light: {
        mac: {
            textPrimary: "black",
            textSecondary: "gray",
            backgroundPrimary: "rgba(246, 246, 246, 1)",
            backgroundSecondary: "rgba(252, 252, 252, 1)",
            borderPrimary: "rgba(221, 221, 221, 1)",
            buttonNonClicked: "#ebe5eb",
            buttonClicked: "#cdc6cd",
            titlebarBackgroundPrimary: "rgba(252, 252, 252, 1)",
            link: "#0A84FF",
            danger: "#FF3B31"
        },
        windows: {
            textPrimary: "black",
            textSecondary: "gray",
            backgroundPrimary: "rgba(246, 246, 246, 1)",
            backgroundSecondary: "rgba(252, 252, 252, 1)",
            borderPrimary: "rgba(221, 221, 221, 1)",
            buttonNonClicked: "#ebe5eb",
            buttonClicked: "#cdc6cd",
            titlebarBackgroundPrimary: "rgba(252, 252, 252, 1)",
            link: "#0A84FF",
            danger: "#FF3B31"
        },
        linux: {
            textPrimary: "black",
            textSecondary: "gray",
            backgroundPrimary: "rgba(246, 246, 246, 1)",
            backgroundSecondary: "rgba(252, 252, 252, 1)",
            borderPrimary: "rgba(221, 221, 221, 1)",
            buttonNonClicked: "#ebe5eb",
            buttonClicked: "#cdc6cd",
            titlebarBackgroundPrimary: "rgba(252, 252, 252, 1)",
            link: "#0A84FF",
            danger: "#FF3B31"
        }
    }
}

const getColor = (platform, darkMode, name) => {
    return typeof colors[darkMode ? 'dark' : 'light'][platform][name] == "undefined" ? "#000000" : colors[darkMode ? 'dark' : 'light'][platform][name]
}

export default getColor