export type CallDevicePreferences={audioDeviceId?:string;videoDeviceId?:string};
export class LocalCallPreview{
 private generation=0;private stream:MediaStream|null=null;private pending=false;
 constructor(private getMedia?:(constraints:MediaStreamConstraints)=>Promise<MediaStream>){}
 async start(mode:"audio"|"video",devices:CallDevicePreferences={}){
  if(this.pending)return null;this.stop();const generation=this.generation;this.pending=true;
  try{const acquire=this.getMedia??navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
   const stream=await acquire({audio:devices.audioDeviceId?{deviceId:{exact:devices.audioDeviceId}}:true,
    video:mode==="video"?(devices.videoDeviceId?{deviceId:{exact:devices.videoDeviceId}}:true):false});
   if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return null;}
   this.stream=stream;return stream;
  }finally{this.pending=false;}
 }
 stop(){this.generation++;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;}
}
