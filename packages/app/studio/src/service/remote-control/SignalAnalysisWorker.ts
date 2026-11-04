import {analyzeSignal} from "./SignalAnalysis"
self.onmessage = event => {
    try {self.postMessage({ok:true,result:analyzeSignal(event.data.channels,event.data.fromFrame,event.data.toFrame)})}
    catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:"Analysis failed"})}
}
