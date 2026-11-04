/** Authenticate in a popup so signing in does not navigate away from the open project. */
export const remoteIdentity = (): Promise<string> => {
    const existing = sessionStorage.getItem("opendaw.identity")
    try {
        if (existing && JSON.parse(atob(existing.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp > Date.now() / 1000 + 30) {
            return Promise.resolve(existing)
        }
    } catch { /* An expired or malformed local identity is replaced through sign-in. */ }
    const name = `opendaw-login-${crypto.randomUUID()}`
    const channel = new BroadcastChannel(name)
    // COOP severs window.opener during hosted sign-in; BroadcastChannel works when the popup returns.
    const popup = window.open(`/remote-signin.html?channel=${encodeURIComponent(name)}`, "_blank", "popup,width=520,height=700")
    if (!popup) {channel.close(); return Promise.reject(new Error("Allow the sign-in popup, then connect again"))}
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            channel.close()
            reject(new Error("Sign-in timed out. Click Connect agent to try again"))
        }, 300_000)
        channel.onmessage = event => {
            if (event.data?.type !== "signed-in" || typeof event.data.token !== "string") {return}
            clearTimeout(timer)
            channel.close()
            sessionStorage.setItem("opendaw.identity", event.data.token)
            resolve(event.data.token)
        }
    })
}
