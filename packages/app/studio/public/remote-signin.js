const status=document.getElementById('status'),retry=document.getElementById('retry')
const config=await fetch('/remote-config.json',{cache:'no-store'}).then(r=>r.json())
const redirect='https://gettelecode.com/remote-signin.html'
const encode=value=>btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')
const random=()=>encode(crypto.getRandomValues(new Uint8Array(32)))
const params=new URLSearchParams(location.search)
if(params.has('channel')) {
 const channel=params.get('channel')
 if(!/^opendaw-login-[0-9a-f-]{36}$/.test(channel))throw Error('Invalid sign-in request')
 sessionStorage.setItem('opendaw.login-channel',channel)
}
async function signIn() {
 if(!sessionStorage.getItem('opendaw.login-channel'))throw Error('Start sign-in from Studio or the authorization page')
 const verifier=random(),state=random()
 sessionStorage.setItem('opendaw.popup-pkce',verifier);sessionStorage.setItem('opendaw.popup-state',state)
 const challenge=encode(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)))
 const url=new URL(config.authDomain+'/oauth2/authorize')
 url.search=new URLSearchParams({client_id:config.clientId,response_type:'code',scope:'openid email',redirect_uri:redirect,state,code_challenge_method:'S256',code_challenge:challenge})
 location.assign(url)
}
retry.onclick=()=>signIn().catch(failed)
function failed(e){status.textContent=e.message;retry.hidden=false}
try {
 if(params.has('error'))throw Error(params.get('error_description')??'Sign-in failed')
 if(params.has('code')) {
  const expected=sessionStorage.getItem('opendaw.popup-state'),verifier=sessionStorage.getItem('opendaw.popup-pkce')
  sessionStorage.removeItem('opendaw.popup-state');sessionStorage.removeItem('opendaw.popup-pkce');history.replaceState(null,'','/remote-signin.html')
  if(!expected||expected!==params.get('state')||!verifier)throw Error('Sign-in state mismatch; try again')
  const r=await fetch(config.authDomain+'/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:config.clientId,redirect_uri:redirect,code:params.get('code'),code_verifier:verifier})})
  const result=await r.json();if(!r.ok||!result.id_token)throw Error('Sign-in failed')
  const channel=new BroadcastChannel(sessionStorage.getItem('opendaw.login-channel'))
  channel.postMessage({type:'signed-in',token:result.id_token});channel.close();sessionStorage.removeItem('opendaw.login-channel')
  status.textContent='Signed in. You can close this window.';window.close()
 } else await signIn()
} catch(e){failed(e)}
