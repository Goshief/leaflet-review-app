import { sendSmtpMail } from "@/lib/leaflet-review/smtp";

export async function sendLeafletNotification(supabase:any,leafletId:string){
  const {data:outbox,error}=await supabase.from("leaflet_notification_outbox").select("*").eq("leaflet_id",leafletId).eq("channel","email").maybeSingle();
  if(error||!outbox)return {sent:false,reason:error?.message||"missing_outbox"};
  if(outbox.status==="sent")return {sent:true,reason:"already_sent"};

  const recipient=(process.env.LEAFLET_ALERT_EMAIL||outbox.recipient||"").trim();
  const smtpHost=(process.env.SMTP_HOST||"").trim();
  const smtpPort=Number(process.env.SMTP_PORT||"465");
  const smtpUser=(process.env.SMTP_USER||"").trim();
  const smtpPass=(process.env.SMTP_PASS||"").trim();
  const smtpFrom=(process.env.SMTP_FROM||process.env.LEAFLET_EMAIL_FROM||smtpUser||"").trim();
  const resendKey=(process.env.RESEND_API_KEY||"").trim();
  const resendFrom=(process.env.LEAFLET_EMAIL_FROM||"").trim();
  const hasSmtp=Boolean(smtpHost&&smtpPort&&smtpUser&&smtpPass&&smtpFrom&&recipient);
  const hasResend=Boolean(resendKey&&resendFrom&&recipient);

  if(!hasSmtp&&!hasResend){
    const missing=[!recipient?"LEAFLET_ALERT_EMAIL":null,!smtpHost?"SMTP_HOST":null,!smtpUser?"SMTP_USER":null,!smtpPass?"SMTP_PASS":null].filter(Boolean).join(", ");
    const message=`Čeká na bezplatnou SMTP konfiguraci${missing?`: ${missing}`:""}. Alternativně lze použít RESEND_API_KEY.`;
    await supabase.from("leaflet_notification_outbox").update({status:"pending",last_error:message}).eq("id",outbox.id);
    await supabase.from("leaflet_documents").update({notification_status:"pending"}).eq("id",leafletId);
    return {sent:false,reason:"email_not_configured",missing};
  }

  try{
    let provider="smtp";
    if(hasSmtp){
      await sendSmtpMail({host:smtpHost,port:smtpPort,user:smtpUser,pass:smtpPass,from:smtpFrom,to:recipient,subject:String(outbox.subject||"Nový leták"),text:String(outbox.body_text||"")});
    }else{
      provider="resend";
      const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${resendKey}`,"Content-Type":"application/json"},body:JSON.stringify({from:resendFrom,to:[recipient],subject:outbox.subject,text:outbox.body_text})});
      const text=await response.text();
      if(!response.ok)throw new Error(`Email HTTP ${response.status}: ${text.slice(0,500)}`);
    }
    const now=new Date().toISOString();
    await supabase.from("leaflet_notification_outbox").update({status:"sent",sent_at:now,attempts:Number(outbox.attempts||0)+1,last_error:null,recipient}).eq("id",outbox.id);
    await supabase.from("leaflet_documents").update({notification_status:"sent",notification_sent_at:now}).eq("id",leafletId);
    return {sent:true,provider};
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    await supabase.from("leaflet_notification_outbox").update({status:"failed",attempts:Number(outbox.attempts||0)+1,last_error:message}).eq("id",outbox.id);
    await supabase.from("leaflet_documents").update({notification_status:"failed"}).eq("id",leafletId);
    return {sent:false,reason:message};
  }
}
