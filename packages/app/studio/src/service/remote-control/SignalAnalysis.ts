import {FFT} from "@opendaw/lib-dsp"

// ITU-R BS.1770-5 Annex 1 (48 kHz stereo K-weighting and gating), Annex 2 FIR.
// Only mono/stereo 48 kHz PCM is accepted; no implied multichannel mapping.
const FIR = [
[.001708984375,-.0291748046875,-.0189208984375,-.00830078125],
[.010986328125,.029296875,.0330810546875,.014892578125],
[-.0196533203125,-.0517578125,-.0582275390625,-.026611328125],
[.033203125,.089111328125,.1015625,.047607421875],
[-.0594482421875,-.16650390625,-.2003173828125,-.102294921875],
[.1373291015625,.465087890625,.77978515625,.97216796875],
[.97216796875,.77978515625,.465087890625,.1373291015625],
[-.102294921875,-.2003173828125,-.16650390625,-.0594482421875],
[.047607421875,.1015625,.089111328125,.033203125],
[-.026611328125,-.0582275390625,-.0517578125,-.0196533203125],
[.014892578125,.0330810546875,.029296875,.010986328125],
[-.00830078125,-.0189208984375,-.0291748046875,.001708984375]]
const db = (x: number) => x > 0 ? 10 * Math.log10(x) : null
const loud = (x: number) => x > 0 ? -.691 + 10 * Math.log10(x) : null
const mean = (a: number[]) => a.reduce((s,v)=>s+v,0)/a.length
const percentile = (a: number[], q: number) => {const b=[...a].sort((x,y)=>x-y);const t=(b.length-1)*q;return b[Math.floor(t)]+(b[Math.ceil(t)]-b[Math.floor(t)])*(t%1)}
function filter(b: number[], a: number[]) {
    let x1=0,x2=0,y1=0,y2=0
    return (x: number) => {const y=b[0]*x+b[1]*x1+b[2]*x2-a[0]*y1-a[1]*y2;x2=x1;x1=x;y2=y1;y1=y;return y}
}
export function analyzeSignal(channels: ReadonlyArray<Float32Array>, fromFrame: number, toFrame: number) {
    if(channels.length<1||channels.length>2||channels.some(c=>c.length!==channels[0].length))throw Error("Expected aligned mono/stereo 48 kHz PCM")
    if(!Number.isInteger(fromFrame)||!Number.isInteger(toFrame)||fromFrame<0||toFrame<=fromFrame||toFrame>channels[0].length)throw Error("Invalid analysis frame range")
    const sampleRate=48000, hop=4800, count=toFrame-fromFrame, bins=Math.ceil(count/hop)
    const energy=new Float64Array(bins), peaks=new Float64Array(bins), k=new Float64Array(bins), lengths=new Uint32Array(bins)
    const perChannel: Array<{samplePeakDbfs:number|null,truePeakDbtp:number|null,rmsDbfs:number|null,dcOffset:number,fullScaleSamples:number,truePeakTimeSeconds:number|null}>=[]
    let cross=0,leftEnergy=0,rightEnergy=0
    for(let ch=0;ch<channels.length;ch++) {
        const pcm=channels[ch], shelf=filter([1.53512485958697,-2.69169618940638,1.19839281085285],[-1.69065929318241,.73248077421585]), high=filter([1,-2,1],[-1.99004745483398,.99007225036621])
        let sum=0,square=0,peak=0,tp=0,tpFrame=fromFrame,fullScale=0
        // Process preceding PCM to warm the filters; measure only the requested range.
        for(let n=0;n<toFrame;n++) {
            const x=pcm[n];if(!Number.isFinite(x))throw Error("Non-finite audio sample")
            const y=high(shelf(x))
            if(n<fromFrame)continue
            const bin=Math.floor((n-fromFrame)/hop), abs=Math.abs(x)
            sum+=x;square+=x*x;peak=Math.max(peak,abs);if(abs>=1)fullScale++
            energy[bin]+=x*x;peaks[bin]=Math.max(peaks[bin],abs);k[bin]+=y*y
            if(ch===0){lengths[bin]++;leftEnergy+=x*x;if(channels.length===2)cross+=x*channels[1][n]}else rightEnergy+=x*x
        }
        // Evaluate interpolants with real context on both sides; do not crop before FIR filtering.
        for(let n=fromFrame;n<=toFrame;n++)for(let phase=0;phase<4;phase++) {
            const time=n-.875+phase/4;if(time<fromFrame||time>=toFrame)continue
            let v=0;for(let tap=0;tap<12;tap++){const i=n+5-tap;if(i>=0&&i<pcm.length)v+=FIR[tap][phase]*pcm[i]}
            if(Math.abs(v)>tp){tp=Math.abs(v);tpFrame=time}
        }
        if(peak>tp){tp=peak;tpFrame=fromFrame+pcm.subarray(fromFrame,toFrame).findIndex(v=>Math.abs(v)===peak)}
        perChannel.push({samplePeakDbfs:db(peak*peak),truePeakDbtp:db(tp*tp),rmsDbfs:db(square/count),dcOffset:sum/count,fullScaleSamples:fullScale,truePeakTimeSeconds:tp>0?tpFrame/sampleRate:null})
    }
    const blocks=(size:number)=>{const out:number[]=[];for(let i=0;i+size<=bins;i++){let e=0,frames=0;for(let j=0;j<size;j++){e+=k[i+j];frames+=lengths[i+j]}if(frames===size*hop)out.push(e/frames)}return out}
    const moments=blocks(4), shorts=blocks(30), absolute=moments.filter(e=>(loud(e)??-Infinity)>-70)
    const threshold=absolute.length?(loud(mean(absolute))!-10):Infinity, gated=absolute.filter(e=>loud(e)!>threshold)
    const integrated=gated.length?loud(mean(gated)):null, shortAbsolute=shorts.filter(e=>(loud(e)??-Infinity)>-70)
    const lraGate=shortAbsolute.length?loud(mean(shortAbsolute))!-20:Infinity
    const lraValues=shortAbsolute.filter(e=>loud(e)!>lraGate).map(e=>loud(e)!)
    const windows=Array.from({length:bins},(_,i)=>({projectSeconds:(fromFrame+i*hop)/sampleRate,durationSeconds:lengths[i]/sampleRate,
        samplePeakDbfs:db(peaks[i]*peaks[i]),rmsDbfs:db(energy[i]/(lengths[i]*channels.length)),momentaryLufs:i>=3&&lengths[i]===hop?loud(moments[i-3]):null,
        shortTermLufs:i>=29&&lengths[i]===hop?loud(shorts[i-29]):null}))
    const bands=[20,60,120,250,2000,6000,24000], bandEnergy=new Float64Array(6), fft=new FFT(4096), real=new Float32Array(4096), imag=new Float32Array(4096)
    let segments=0,windowPower=0;const hann=Float32Array.from({length:4096},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/4095));for(const v of hann)windowPower+=v*v
    for(const pcm of channels)for(let start=fromFrame;start+4096<=toFrame;start+=4096){for(let i=0;i<4096;i++){real[i]=pcm[start+i]*hann[i];imag[i]=0}fft.process(real,imag);segments++
        for(let i=1;i<=2048;i++){const hz=i*sampleRate/4096;const band=bands.findIndex((edge,j)=>j<6&&hz>=edge&&hz<bands[j+1]);if(band>=0)bandEnergy[band]+=(real[i]*real[i]+imag[i]*imag[i])*(i===2048?1:2)/(4096*windowPower)}
    }
    return {sampleRate,durationSeconds:count/sampleRate,fromSeconds:fromFrame/sampleRate,toSeconds:toFrame/sampleRate,
        method:{loudness:"BS.1770 K-weighting, 400ms/100ms gated blocks",truePeak:"BS.1770 Annex 2 4x FIR estimate",lra:"short-term 100ms sampling, absolute/-20LU gating; 10th/95th percentiles"},
        integratedLufs:integrated,maxMomentaryLufs:moments.length?loud(Math.max(...moments)):null,maxShortTermLufs:shorts.length?loud(Math.max(...shorts)):null,
        loudnessRangeLu:lraValues.length>=2?percentile(lraValues,.95)-percentile(lraValues,.1):null,
        stereoCorrelation:channels.length===2&&leftEnergy>0&&rightEnergy>0?cross/Math.sqrt(leftEnergy*rightEnergy):null,
        silenceThresholdDbfs:-80,silenceSeconds:windows.filter(w=>w.rmsDbfs===null||w.rmsDbfs<-80).reduce((s,w)=>s+w.durationSeconds,0),
        perChannel,frequencyBands:bands.slice(0,6).map((low,i)=>({fromHz:low,toHz:bands[i+1],meanPowerDbfs:segments?db(bandEnergy[i]/segments):null})),spectralResolutionHz:sampleRate/4096,
        unavailableReasons:{integratedLufs:count<19200?"Requires at least 400ms":integrated===null?"No blocks above loudness gates":null,shortTermLufs:count<144000?"Requires at least 3 seconds":null,loudnessRange:count<144000?"Requires at least 3 seconds; short excerpts are not programme LRA":null},windows}
}
