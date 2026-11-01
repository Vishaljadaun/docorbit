import {useEffect, useState} from 'react';
import {Download, Smartphone, X} from 'lucide-react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{outcome:'accepted'|'dismissed'}>;
};

/** Browser install is user-controlled. iOS requires Safari > Share > Add to Home Screen. */
export default function InstallApp(){
  const [promptEvent,setPromptEvent]=useState<InstallPromptEvent|null>(null);
  const [mobile,setMobile]=useState(false);
  const [ios,setIos]=useState(false);
  const [installed,setInstalled]=useState(false);
  const [help,setHelp]=useState(false);

  useEffect(()=>{
    const standalone=window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & {standalone?:boolean}).standalone===true;
    setInstalled(standalone);
    setMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
    setIos(/iPhone|iPad|iPod/i.test(navigator.userAgent));
    const onPrompt=(event:Event)=>{
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled=()=>{
      setInstalled(true);
      setPromptEvent(null);
      setHelp(false);
    };
    window.addEventListener('beforeinstallprompt',onPrompt);
    window.addEventListener('appinstalled',onInstalled);
    return ()=>{
      window.removeEventListener('beforeinstallprompt',onPrompt);
      window.removeEventListener('appinstalled',onInstalled);
    };
  },[]);

  async function install(){
    if(!promptEvent){
      setHelp(value=>!value);
      return;
    }
    try{
      await promptEvent.prompt();
      const choice=await promptEvent.userChoice;
      setPromptEvent(null);
      if(choice.outcome==='accepted')setHelp(false);
      else setHelp(true);
    }catch{
      setHelp(true);
    }
  }

  if(installed||(!mobile&&!promptEvent))return null;
  return <div className="app-install-wrap">
    <button type="button" className="app-install-trigger" onClick={()=>void install()}
      aria-expanded={help} aria-label="Install DocOrbit on this device">
      <Download size={15}/>
      <span>Install app</span>
    </button>
    {help&&<div className="app-install-help" role="status">
      <div className="app-install-help-heading">
        <Smartphone size={17}/>
        <strong>Add DocOrbit to your phone</strong>
        <button type="button" aria-label="Close install guidance" onClick={()=>setHelp(false)}><X size={16}/></button>
      </div>
      {ios
        ?<p>Open DocOrbit in <strong>Safari</strong>, tap <strong>Share</strong>, select <strong>Add to Home Screen</strong>, and tap <strong>Add</strong>.</p>
        :<p>In <strong>Chrome</strong>, open the <strong>⋮ menu</strong>, choose <strong>Add to Home screen</strong> or <strong>Install app</strong>, then confirm.</p>}
      <small>No app store or APK needed. DocOrbit uses the same online tools and website.</small>
    </div>}
  </div>;
}
