import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import nodemailer from "npm:nodemailer";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

serve(async (req) => {

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {

    const { to, subject, body, attachments } = await req.json();


    const smtpUser = Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("SMTP_PASS");

    if (!smtpUser || !smtpPass) {
      throw new Error("Credenciais SMTP não configuradas no Supabase.");
    }


    const transporter = nodemailer.createTransport({
      host: "smtppro.zoho.com",
      port: 465,
      secure: true,
      auth: { user: smtpUser, pass: smtpPass },

      connectionTimeout: 10000,
      socketTimeout: 10000
    });


    let attempt = 0;
    let lastError: any = null;
    let sentInfo = null;

    while (attempt < MAX_RETRIES) {
      try {
        attempt++;
        console.log(`Tentativa de envio ${attempt}/${MAX_RETRIES} para: ${to}`);

        sentInfo = await transporter.sendMail({
          from: `"KNConecta" <${smtpUser}>`,
          to: to,
          subject: subject,
          text: body,
          attachments: attachments
        });


        console.log("E-mail enviado com sucesso na tentativa:", attempt);
        break;

      } catch (err) {
        lastError = err;
        console.warn(`Falha na tentativa ${attempt}:`, err.message);


        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
        }
      }
    }


    if (!sentInfo) {

      throw new Error(`Falha definitiva após ${MAX_RETRIES} tentativas. Erro: ${lastError?.message}`);
    }

    return new Response(JSON.stringify({ message: "E-mail enviado com sucesso!" }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error: any) {
    console.error("Erro CRÍTICO na Edge Function:", error);
    return new Response(JSON.stringify({ error: `Falha ao enviar e-mail: ${error.message}` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});