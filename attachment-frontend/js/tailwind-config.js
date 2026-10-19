// Shared Tailwind (CDN) theme used by the coordinator pages.
tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    "colors": {
                        "on-surface-variant": "#44474e",
                        "on-background": "#191c1e",
                        "secondary-fixed-dim": "#b0c6ff",
                        "on-secondary-fixed": "#001945",
                        "surface-container-low": "#f2f4f6",
                        "surface": "#f7f9fb",
                        "background": "#f7f9fb",
                        "on-surface": "#191c1e",
                        "on-primary-fixed": "#001b3d",
                        "on-secondary-fixed-variant": "#00429c",
                        "inverse-on-surface": "#eff1f3",
                        "surface-container-high": "#e6e8ea",
                        "on-primary-container": "#708ab5",
                        "tertiary-fixed-dim": "#b7c8e1",
                        "outline-variant": "#c4c6cf",
                        "on-tertiary-fixed": "#0b1c30",
                        "surface-container-lowest": "#ffffff",
                        "primary-fixed-dim": "#aec7f6",
                        "tertiary-container": "#122236",
                        "on-secondary": "#ffffff",
                        "on-tertiary-fixed-variant": "#38485d",
                        "surface-variant": "#e0e3e5",
                        "surface-dim": "#d8dadc",
                        "surface-bright": "#f7f9fb",
                        "primary": "#000a1e",
                        "primary-container": "#002147",
                        "on-primary-fixed-variant": "#2d476f",
                        "tertiary-fixed": "#d3e4fe",
                        "secondary-container": "#006df8",
                        "on-tertiary-container": "#7a8aa2",
                        "error-container": "#ffdad6",
                        "on-error-container": "#93000a",
                        "outline": "#74777f",
                        "inverse-surface": "#2d3133",
                        "on-secondary-container": "#fefcff",
                        "secondary": "#0056c6",
                        "on-tertiary": "#ffffff",
                        "inverse-primary": "#aec7f6",
                        "secondary-fixed": "#d9e2ff",
                        "on-primary": "#ffffff",
                        "surface-container": "#eceef0",
                        "on-error": "#ffffff",
                        "tertiary": "#000b1b",
                        "surface-tint": "#465f88",
                        "error": "#ba1a1a",
                        "surface-container-highest": "#e0e3e5",
                        "primary-fixed": "#d6e3ff"
                    },
                    "borderRadius": {
                        "DEFAULT": "0.125rem",
                        "lg": "0.25rem",
                        "xl": "0.5rem",
                        "full": "0.75rem"
                    },
                    "spacing": {
                        "stack-lg": "32px",
                        "stack-md": "16px",
                        "base": "4px",
                        "sidebar-width": "260px",
                        "container-padding": "24px",
                        "stack-sm": "8px",
                        "gutter": "16px"
                    },
                    "fontFamily": {
                        "body-lg": ["Inter"],
                        "headline-md": ["Inter"],
                        "headline-sm": ["Inter"],
                        "display-lg-mobile": ["Inter"],
                        "label-md": ["Inter"],
                        "display-lg": ["Inter"],
                        "body-md": ["Inter"],
                        "code-sm": ["Inter"]
                    },
                    "fontSize": {
                        "body-lg": ["16px", { "lineHeight": "24px", "fontWeight": "400" }],
                        "headline-md": ["24px", { "lineHeight": "32px", "fontWeight": "600" }],
                        "headline-sm": ["20px", { "lineHeight": "28px", "fontWeight": "600" }],
                        "display-lg-mobile": ["28px", { "lineHeight": "34px", "letterSpacing": "-0.01em", "fontWeight": "700" }],
                        "label-md": ["12px", { "lineHeight": "16px", "letterSpacing": "0.05em", "fontWeight": "600" }],
                        "display-lg": ["36px", { "lineHeight": "44px", "letterSpacing": "-0.02em", "fontWeight": "700" }],
                        "body-md": ["14px", { "lineHeight": "20px", "fontWeight": "400" }],
                        "code-sm": ["13px", { "lineHeight": "18px", "fontWeight": "400" }]
                    }
                }
            }
        }
