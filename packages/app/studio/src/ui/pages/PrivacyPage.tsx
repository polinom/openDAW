import css from "./PrivacyPage.sass?inline"
import {createElement, PageContext, PageFactory} from "@opendaw/lib-jsx"
import {StudioService} from "@/service/StudioService.ts"
import {Html} from "@opendaw/lib-dom"
import {Colors} from "@opendaw/studio-enums"
import {installScrollbars} from "@/ui/components/Scrollbars"

const className = Html.adoptStyleSheet(css, "PrivacyPage")

export const PrivacyPage: PageFactory<StudioService> = ({lifecycle}: PageContext<StudioService>) => (
    <div className={className} onConnect={host => lifecycle.own(installScrollbars(host))}>
        <h1>Privacy Policy</h1>
        {["gettelecode.com", "www.gettelecode.com"].includes(location.hostname) ? <div>
            <h3>Project storage</h3>
            <p>Projects and samples are saved in this browser or files you choose to export.</p>
            <h3>Optional Remote Control</h3>
            <p>Remote Control can create a private connection link without an account. Anyone holding that link
                can read and edit the connected project through scripts and control playback. The optional account-based connection uses AWS Cognito and your email address.
                When you connect a tab and give its link to an agent, project state and commands pass through the
                hosted AWS bridge. Project state includes device code, notes, automation and asset references;
                audio file bytes are not included in project-state reads. Samples explicitly uploaded by your agent pass through a private temporary AWS bucket before being saved in this browser. Completed transfer files are deleted when job status is collected; abandoned files expire through a one-day lifecycle rule.</p>
            <p>The bridge stores session authorization and temporary command results, including
                requested project-state pages. Your authorized agent receives those pages and may retain them
                according to its own service settings. The private link and a separate reconnect credential stay in this browser until you disconnect. The bridge retains their hashes until revoked; closing or refreshing a tab does not revoke the link. Disconnecting revokes further access; if offline, revocation retries when you reopen the app.</p>
            <h3>Cloud connections</h3>
            <p>Connecting a separate cloud backup or live-room service shares data with that service as part
                of the feature you choose to use.</p>
        </div> : <div>
        <p style={{color: Colors.blue.toString()}}>openDAW respects your privacy. This application does not collect
            personal data, or create user accounts.</p>
        <h3>Local storage</h3>
        <p>Your projects and samples are stored on your own device (local file system or browser storage). No
            personal information is sent to our servers.</p>
        <h3>Cloud connections</h3>
        <p>If you choose to connect a cloud service (e.g. Google Drive or Dropbox), openDAW uses the official OAuth
            process. The access tokens are stored only in your browser or desktop app and are never shared with us.</p>
        <h3>Data usage</h3>
        <p>openDAW does not process, analyze, or share any personal data. Files remain under your control in your chosen
            storage location.</p>
        <h3>Visitor counting</h3>
        <p>We count unique visitors per day. Our server derives a temporary identifier from data your browser sends
            with every request anyway (IP address and browser version), using a secret key that is deleted within
            24 hours, after which the identifier cannot be recreated. Nothing is stored on or read from your device,
            and no data is shared with anyone. This counting complies with the GDPR (DSGVO) and §25 TDDDG and
            therefore requires no consent banner.</p>
        <h3>Contact</h3>
        <p>For questions about this policy, contact: <a style={{color: Colors.blue}}
                                                        href="mailto:hello@opendaw.org">hello@opendaw.org</a>
        </p>
        </div>}
    </div>
)