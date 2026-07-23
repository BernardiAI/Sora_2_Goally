import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { assetForJob } from "../../../../../lib/generation-store";
export const runtime="nodejs";
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params; const asset=assetForJob(id);
  if(!asset?.verified || !asset.path || !existsSync(asset.path)) return NextResponse.json({error:{code:"asset_not_available",message:"The verified local video asset is not available.",retryable:true,jobId:id}},{status:404});
  const size=statSync(asset.path).size; const range=request.headers.get("range");
  let start=0,end=size-1,status=200;
  if(range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!match || (!match[1]&&!match[2]))return new NextResponse(null,{status:416,headers:{"Content-Range":`bytes */${size}`}});
    if(match[1]){
      start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),size-1):size-1;
    }else{
      const suffix=Number(match[2]);start=Math.max(0,size-suffix);end=size-1;
    }
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return new NextResponse(null,{status:416,headers:{"Content-Range":`bytes */${size}`}});
    status=206;
  }
  const headers=new Headers({"Content-Type":asset.mime_type||"video/mp4","Accept-Ranges":"bytes","Content-Length":String(end-start+1),"Cache-Control":"private, max-age=3600"});
  if(status===206)headers.set("Content-Range",`bytes ${start}-${end}/${size}`);
  return new NextResponse(Readable.toWeb(createReadStream(asset.path,{start,end})) as any,{status,headers});
}
