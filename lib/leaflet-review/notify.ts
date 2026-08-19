export async function sendLeafletNotification(supabase:any,leafletId:string){
  const {data:outbox,error}=await supabase.from("leaflet_notification_outbox").select("*").eq("leaflet_id",leafletId).eq("channel","email").maybeSingle();
  if(error||!outbox)return {sent:false,reason:error?.message||"missing_outbox"};
  if(outbox.status==="sent")return {sent:true,reason:"already_sent"};
  const apiKey=process.env.RESEND_API_KEY?.trim();
  const recipient=(process.env.LEAFLET_ALERT_EMAIL||outbox.recipient||"").trim();
  const from=(process.env.LEAFLET_EMAIL_FROM||"").trim();
  if(!apiKey||!recipient||!from){
    await supabase.from("leaflet_notification_outbox").update({status:"disabled",last_error:"Chybí RESEND_API_KEY, LEAFLET_ALERT_EMAIL nebo LEAFLET_EMAIL_FROM."}).eq("id",outbox.id);
    await supabase.from("leaflet_documents").update({notification_status:"disabled"}).eq("id",leafletId);
    return {sent:false,reason:"email_not_configured"};
  }
  try{
    const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[recipient],subject:outbox.subject,text:outbox.body_text})});
    const text=await response.text();
    if(!response.ok)throw new Error(`Email HTTP ${response.status}: ${text.slice(0,500)}`);
    const now=new Date().toISOString();
    await supabase.from("leaflet_notification_outbox").update({status:"sent",sent_at:now,attempts:Number(outbox.attempts||0)+1,last_error:null,recipient}).eq("id",outbox.id);
    await supabase.from("leaflet_documents").update({notification_status:"sent",notification_sent_at:now}).eq("id",leafletId);
    return {sent:true};
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    await supabase.from("leaflet_notification_outbox").update({status:"failed",attempts:Number(outbox.attempts||0)+1,last_error:message}).eq("id",outbox.id);
    await supabase.from("leaflet_documents").update({notification_status:"failed"}).eq("id",leafletId);
    return {sent:false,reason:message};
  }
}
