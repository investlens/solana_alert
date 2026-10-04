import {getIndexedVerifiedPonsLaunch,isVerifiedPonsLaunch} from './ponsLaunchState.js';
import {isVerifiedFlapLaunch} from './flapLaunchState.js';
export type TrustedRobinhoodLaunch = {launchType:'PONS'|'FLAP';token:string;deployer:string|null};
export async function getVerifiedRobinhoodLaunchpad(token:string):Promise<TrustedRobinhoodLaunch|null>{
  if(!/^0x[a-f0-9]{40}$/i.test(token))return null;
  const pons=await getIndexedVerifiedPonsLaunch(token);
  if(pons)return {launchType:'PONS',token:pons.token,deployer:pons.deployer};
  if(await isVerifiedFlapLaunch(token))return {launchType:'FLAP',token,deployer:null};
  if(await isVerifiedPonsLaunch(token).catch(()=>false))return {launchType:'PONS',token,deployer:null};
  return null;
}
