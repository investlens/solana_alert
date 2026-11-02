/** Program provenance research classification, NEVER signing authorization.
 * Official IDs are documented by pump-fun/pump-public-docs. A recognizable
 * ID alone cannot prove currently deployed executable bytes match the docs.
 */
export const ECHO_PROGRAM_REVIEW_GRANTS_SIGNING=false as const;
export const ECHO_PROGRAM_IDS={
 pump:'6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
 pumpSwap:'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
 pumpFees:'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ'
} as const;
const canonical=new Set(Object.values(ECHO_PROGRAM_IDS));
export type EchoProgramProvenanceInput={
 programIds:readonly string[];
 /** Onchain account data read at a known slot (code hash alone ≠ verified source). */
 executableState?:Readonly<Record<string,{executable:boolean;loader:string;
  programDataHash?:string;upgradeAuthority?:string|null}>>;
};
export function reviewEchoProgramProvenance(input:EchoProgramProvenanceInput){
 if(!Array.isArray(input.programIds)||input.programIds.length<1||
  input.programIds.length>48||input.programIds.some(x=>typeof x!=='string'||x.length<32))
   return {ok:false as const,reason:'INVALID_PROGRAM_SET',signingApproved:false as const};
 const unrecognized=[...new Set(input.programIds.filter(id=>!canonical.has(id)))];
 const unverified=input.programIds.filter(id=>{
   const e=input.executableState?.[id];
   return !e?.executable||!e.programDataHash||
    !/^[0-9a-f]{64}$/.test(e.programDataHash)||e.upgradeAuthority!==null;
 });
 return {ok:true as const,mode:'PROVENANCE_RESEARCH_ONLY' as const,
  recognizedPumpPrograms:[...new Set(input.programIds.filter(id=>canonical.has(id)))],
  unrecognizedPrograms:unrecognized,
  noVerifiedImmutableBuild:unverified.length>0,
  programsWithoutImmutableByteEvidence:[...new Set(unverified)],
  executableBehaviorVerified:false as const,
  signingApproved:false as const};
}
