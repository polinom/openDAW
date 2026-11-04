const $=id=>document.getElementById(id)
const requestId=new URLSearchParams(location.search).get('request')
const path='/remote-control/oauth/requests/'+encodeURIComponent(requestId??'')
const status=message=>{$('status').textContent=message}
async function request(method='GET',body) {
 const token=sessionStorage.getItem('opendaw.identity');if(!token)throw Error('Sign in first')
 const r=await fetch(path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
 const result=await r.json();if(!r.ok)throw Error(result.error_description??result.error?.message??'Authorization failed')
 return result
}
async function show() {
 const value=await request();$('signin').hidden=true;$('consent').hidden=false
 $('name').textContent=value.clientName;$('callback').textContent='Returns to '+value.redirectOrigin;$('target').textContent='Studio tab '+value.sessionId
 $('permissions').replaceChildren(...value.permissions.map(text=>{const li=document.createElement('li');li.textContent=text;return li}))
 status('This client is requesting access to your connected tab.')
}
$('signin').onclick=()=>{
 const name='opendaw-login-'+crypto.randomUUID(),channel=new BroadcastChannel(name)
 const popup=window.open('/remote-signin.html?channel='+encodeURIComponent(name),'_blank','popup,width=520,height=700')
 if(!popup){channel.close();status('Allow the sign-in popup and try again');return}
 const timer=setTimeout(()=>{channel.close();status('Sign-in timed out. Try again.')},300000)
 channel.onmessage=event=>{
  if(event.data?.type!=='signed-in'||typeof event.data.token!=='string')return
  clearTimeout(timer);channel.close();sessionStorage.setItem('opendaw.identity',event.data.token)
  show().catch(e=>status(e.message))
 }
 status('Waiting for sign-in…')
}
for(const [id,allow] of [['allow',true],['deny',false]]) {
 $(id).onclick=async()=>{
  $('allow').disabled=true;$('deny').disabled=true
  try{const value=await request('POST',{allow});location.assign(value.redirect)}
  catch(e){status(e.message);$('allow').disabled=false;$('deny').disabled=false}
 }
}
if(sessionStorage.getItem('opendaw.identity'))show().catch(e=>{status(e.message);$('signin').hidden=false})
