import tls from "node:tls";

function encodeHeader(value:string){return `=?UTF-8?B?${Buffer.from(value,"utf8").toString("base64")}?=`;}
function normalizeBody(value:string){return value.replace(/\r?\n/g,"\r\n").replace(/^\./gm,"..");}

type Reply={code:number;text:string};

async function connect(host:string,port:number,timeoutMs=15000){
  return await new Promise<tls.TLSSocket>((resolve,reject)=>{
    const socket=tls.connect({host,port,servername:host,rejectUnauthorized:true});
    const timer=setTimeout(()=>{socket.destroy();reject(new Error("SMTP connection timeout"));},timeoutMs);
    socket.once("secureConnect",()=>{clearTimeout(timer);resolve(socket)});
    socket.once("error",err=>{clearTimeout(timer);reject(err)});
  });
}

function reader(socket:tls.TLSSocket){
  let buffer="";const queue:Array<(r:Reply)=>void>=[];const errors:Array<(e:Error)=>void>=[];
  const flush=()=>{
    while(queue.length){
      const lines=buffer.split("\r\n");let end=-1;
      for(let i=0;i<lines.length-1;i++){if(/^\d{3} /.test(lines[i]!)){end=i;break;}}
      if(end<0)return;
      const used=lines.slice(0,end+1);buffer=lines.slice(end+1).join("\r\n");
      const last=used[used.length-1]||"000";const code=Number(last.slice(0,3));queue.shift()!({code,text:used.join("\n")});errors.shift();
    }
  };
  socket.on("data",chunk=>{buffer+=chunk.toString("utf8");flush();});
  socket.on("error",e=>{while(errors.length)errors.shift()!(e)});
  return ()=>new Promise<Reply>((resolve,reject)=>{queue.push(resolve);errors.push(reject);flush();});
}

async function expect(read:()=>Promise<Reply>, allowed:number[]){const r=await read();if(!allowed.includes(r.code))throw new Error(`SMTP ${r.code}: ${r.text.slice(0,400)}`);return r;}

export async function sendSmtpMail(args:{host:string;port:number;user:string;pass:string;from:string;to:string;subject:string;text:string}){
  const socket=await connect(args.host,args.port);const read=reader(socket);
  const write=(value:string)=>socket.write(`${value}\r\n`);
  try{
    await expect(read,[220]);
    write(`EHLO leaflet-review-app`);await expect(read,[250]);
    write("AUTH LOGIN");await expect(read,[334]);
    write(Buffer.from(args.user,"utf8").toString("base64"));await expect(read,[334]);
    write(Buffer.from(args.pass,"utf8").toString("base64"));await expect(read,[235]);
    write(`MAIL FROM:<${args.from}>`);await expect(read,[250]);
    write(`RCPT TO:<${args.to}>`);await expect(read,[250,251]);
    write("DATA");await expect(read,[354]);
    const message=[
      `From: <${args.from}>`,`To: <${args.to}>`,`Subject: ${encodeHeader(args.subject)}`,
      "MIME-Version: 1.0","Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: 8bit","",
      normalizeBody(args.text),"."
    ].join("\r\n");
    socket.write(`${message}\r\n`);await expect(read,[250]);
    write("QUIT");await expect(read,[221]);
    return {sent:true};
  }finally{socket.end();}
}
