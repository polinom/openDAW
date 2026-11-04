/** The hosted fork serves upstream read-only catalogs through its own origin. */
const hosted = typeof location !== "undefined" && ["gettelecode.com", "www.gettelecode.com"].includes(location.hostname)
export const HostedApi = {
    apiRoot: hosted ? "/library/api" : "https://api.opendaw.studio",
    assetRoot: hosted ? "/library/assets" : "https://assets.opendaw.studio"
} as const
