import colors from "./colors"
import { EditorView } from "@codemirror/view"

export const createCodeMirrorTheme = ({ platform, darkMode }: { platform: string; darkMode: boolean }) => {
	return EditorView.theme(
		{
			"&": {
				color: colors(platform, darkMode, "textPrimary"),
				backgroundColor: colors(platform, darkMode, "backgroundPrimary")
			},
			".cm-content": {
				caretColor: colors(platform, darkMode, "textPrimary")
			},
			".cm-cursor, .cm-dropCursor": {
				borderLeftColor: colors(platform, darkMode, "textPrimary")
			},
			"&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
				backgroundColor: colors(platform, darkMode, "backgroundSecondary")
			},
			".cm-panels": {
				backgroundColor: "yellow",
				color: "green"
			},
			".cm-panels.cm-panels-top": {
				borderBottom: "2px solid black"
			},
			".cm-panels.cm-panels-bottom": {
				borderTop: "2px solid black"
			},
			".cm-searchMatch": {
				backgroundColor: "#72a1ff59",
				outline: "1px solid #457dff"
			},
			".cm-searchMatch.cm-searchMatch-selected": {
				backgroundColor: "#6199ff2f"
			},
			".cm-activeLine": {
				backgroundColor: colors(platform, darkMode, "backgroundSecondary")
			},
			".cm-selectionMatch": {
				backgroundColor: "#aafe661a"
			},
			"&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
				backgroundColor: "#bad0f847",
				outline: "1px solid #515a6b"
			},
			".cm-gutters": {
				backgroundColor: colors(platform, darkMode, "backgroundPrimary"),
				color: colors(platform, darkMode, "textSecondary"),
				border: "none"
			},
			".cm-activeLineGutter": {
				backgroundColor: colors(platform, darkMode, "backgroundPrimary")
			},
			".cm-foldPlaceholder": {
				backgroundColor: "transparent",
				border: "none",
				color: "#ddd"
			},
			".cm-tooltip": {
				border: "none",
				backgroundColor: "gray"
			},
			".cm-tooltip .cm-tooltip-arrow:before": {
				borderTopColor: "transparent",
				borderBottomColor: "transparent"
			},
			".cm-tooltip .cm-tooltip-arrow:after": {
				borderTopColor: "darkgreen",
				borderBottomColor: "darkgreen"
			},
			".cm-tooltip-autocomplete": {
				"& > ul > li[aria-selected]": {
					backgroundColor: "darkgreen",
					color: "darkgreen"
				}
			}
		},
		{
			dark: darkMode
		}
	)
}
