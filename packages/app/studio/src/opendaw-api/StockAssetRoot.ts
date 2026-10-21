/** Optional same-origin asset proxy for preview hosting. Official builds keep their existing origin. */
export const StockAssetRoot = (import.meta.env.VITE_STOCK_ASSET_ROOT || "https://assets.opendaw.studio").replace(/\/$/, "")
