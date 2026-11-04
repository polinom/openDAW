const $ = id => document.getElementById(id)
const config = await fetch('/remote-config.json',{cache:'no-store'}).then(r=>r.json())
const redirect = 'https://gettelecode.com/account.html'
const encode = data => btoa(String.fromCharCode(...new Uint8Array(data))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)))
const status = message => {$('status').textContent=message}
function token() {
    const value=sessionStorage.getItem('opendaw.identity')
    if(!value) throw new Error('Sign in first')
    return value
}
async function request(path,method='GET',body) {
    const r=await fetch('/remote-control'+path,{method,headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
    const result=await r.json()
    if(!r.ok) throw new Error(result.error?.message??'Request failed')
    return result
}
const run = fn => async()=>{try{status('');await fn()}catch(e){status(e.message)}}
$('login').onclick=run(async()=>{
    const verifier=random(),state=random()
    sessionStorage.setItem('opendaw.pkce',verifier);sessionStorage.setItem('opendaw.state',state)
    const challenge=encode(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)))
    const url=new URL(config.authDomain+'/oauth2/authorize')
    url.search=new URLSearchParams({client_id:config.clientId,response_type:'code',scope:'openid email',redirect_uri:redirect,state,code_challenge_method:'S256',code_challenge:challenge})
    location.assign(url)
})
$('logout').onclick=()=>{
    sessionStorage.removeItem('opendaw.identity')
    const url=new URL(config.authDomain+'/logout');url.search=new URLSearchParams({client_id:config.clientId,logout_uri:redirect});location.assign(url)
}
async function refresh() {
    const [credentials,sessions]=await Promise.all([request('/account/tokens'),request('/sessions')])
    $('tokens').replaceChildren();$('sessions').replaceChildren()
    for(const entry of credentials.tokens) {
        const li=document.createElement('li');li.textContent=entry.label+' · expires '+new Date(entry.expiresAt*1000).toLocaleDateString()+' '
        const b=document.createElement('button');b.textContent='Revoke';b.onclick=run(async()=>{await request('/account/tokens/'+entry.id,'DELETE');await refresh()});li.append(b);$('tokens').append(li)
    }
    for(const entry of sessions.sessions) {
        const li=document.createElement('li');li.textContent=entry.sessionId+' '
        const b=document.createElement('button');b.textContent='Disconnect';b.onclick=run(async()=>{await request('/account/sessions/'+entry.sessionId,'DELETE');await refresh()});li.append(b);$('sessions').append(li)
    }
    if(!sessions.sessions.length) $('sessions').textContent='No paired tabs.'
}
$('create').onclick=run(async()=>{const result=await request('/account/tokens','POST',{label:$('label').value});$('secret').hidden=false;$('secret').textContent=result.token;await refresh()})
$('pair').onclick=run(async()=>{const result=await request('/pairing-codes','POST',{});$('code').hidden=false;$('code').textContent=result.code+'\nExpires in 60 seconds.'})
$('refresh').onclick=run(refresh)
const params=new URLSearchParams(location.search)
try {
    if(params.has('error')) throw new Error(params.get('error_description')??'Sign-in failed')
    if(params.has('code')) {
        const expected=sessionStorage.getItem('opendaw.state'),verifier=sessionStorage.getItem('opendaw.pkce')
        sessionStorage.removeItem('opendaw.state');sessionStorage.removeItem('opendaw.pkce')
        history.replaceState(null,'','/account.html')
        if(!expected||params.get('state')!==expected||!verifier) throw new Error('Sign-in state mismatch; try again')
        const r=await fetch(config.authDomain+'/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:config.clientId,redirect_uri:redirect,code:params.get('code'),code_verifier:verifier})})
        const result=await r.json();if(!r.ok||!result.id_token)throw new Error('Sign-in failed')
        sessionStorage.setItem('opendaw.identity',result.id_token)
    }
    if(sessionStorage.getItem('opendaw.identity')) {
        $('account').hidden=false;$('login').hidden=true;$('logout').hidden=false;await refresh()
    }
} catch(e) {status(e.message)}
