/** The URL authorizes agents; the separate resume token authorizes browser reconnection. */
export type BrowserGuestCredential = {url: string, resumeToken: string, ownerPage: string, pendingRevoke?: boolean}
export const browserGuestKey = "opendaw.remote-control.browser-link.v1"
const tabKey = `${browserGuestKey}.tab`
const urlPattern = /^https:\/\/gettelecode\.com\/remote-control\/mcp\/guest\/([a-f0-9-]{36})\/([A-Za-z0-9_-]{43})$/i
export function guestResume(credential: BrowserGuestCredential) {
    const match = urlPattern.exec(credential.url)
    if (!match || !/^[A-Za-z0-9_-]{43}$/.test(credential.resumeToken)) {throw new Error("Invalid browser credential")}
    return {resourceId: match[1], secret: match[2], resumeToken: credential.resumeToken}
}
export class BrowserGuestLink {
    constructor(readonly storage: Storage, readonly tabStorage: Storage, readonly pageId: string) {}
    read(): BrowserGuestCredential | undefined {
        try {
            const value = JSON.parse(this.storage.getItem(browserGuestKey) ?? "null")
            if (!value || typeof value.url !== "string" || typeof value.resumeToken !== "string" || typeof value.ownerPage !== "string") {return undefined}
            guestResume(value)
            return value
        } catch {return undefined}
    }
    canRestore(): boolean {
        const link = this.read()
        return !!link && !link.pendingRevoke && this.tabStorage.getItem(tabKey) === link.ownerPage
    }
    owns(): boolean {return this.read()?.ownerPage === this.pageId}
    save(url: string, resumeToken: string): void {
        const value = {url, resumeToken, ownerPage: this.pageId}
        guestResume(value)
        this.storage.setItem(browserGuestKey, JSON.stringify(value))
        this.tabStorage.setItem(tabKey, this.pageId)
    }
    invalidate(link: BrowserGuestCredential): void {
        if (this.read()?.url === link.url) {this.storage.removeItem(browserGuestKey)}
        this.forgetTab()
    }
    forgetTab(): void {this.tabStorage.removeItem(tabKey)}
    markRevoking(leased = false): BrowserGuestCredential | undefined {
        const link = this.read()
        if (!link || !(this.owns() || leased && this.canRestore())) {this.forgetTab();return undefined}
        const pending = {...link, pendingRevoke: true}
        this.storage.setItem(browserGuestKey, JSON.stringify(pending))
        this.forgetTab()
        return pending
    }
    removeRevoked(link: BrowserGuestCredential): void {
        const current = this.read()
        if (current?.url === link.url && current.pendingRevoke) {this.storage.removeItem(browserGuestKey)}
    }
}
