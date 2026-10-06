"use client";
// Public equipment request — NO login. Its only write is the
// submit_equipment_request() RPC (plus photo uploads into attachments/requests/),
// which rate-limits and logs every attempt. It cannot read anything.
import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { uploadPhoto } from "../../lib/photos";
import { itContact } from "../../lib/site";
import { PublicPage } from "../components/LoginScreens";
import { RequestForm, RequestReceipt } from "../components/RequestForm";
import { Card } from "../components/ui";

// A refused person needs to know what to do next, not see an error code.
const REFUSALS = {
  rate_limited_name: () => `You have already sent 5 requests in the last hour. Please wait an hour before sending another, or call ${itContact()} if it cannot wait.`,
  rate_limited_overall: () => `The request form is very busy right now. Please try again in an hour, or call ${itContact()} if it is urgent.`,
  missing_fields: () => "Please fill in your name and department.",
  invalid_asset_type: () => "Please choose what you need from the list.",
  invalid_urgency: () => "Please choose Normal or Urgent.",
  justification_too_long: () => "Please shorten the explanation to 2000 characters or fewer.",
  invalid_attachment: () => "One of the photos could not be attached. Remove it and try again.",
};

async function submitPublicRequest(fields, files) {
  let urls = [];
  try {
    urls = await Promise.all(files.map((file) => uploadPhoto(file, "requests")));
  } catch {
    throw new Error("The photos could not be uploaded. Check your connection, or remove the photos and send the request without them.");
  }
  const { data, error } = await supabase.rpc("submit_equipment_request", {
    p_name: fields.name, p_department: fields.department, p_asset_type: fields.asset_type,
    p_justification: fields.justification, p_urgency: fields.urgency, p_attachment: urls.join("\n"),
  });
  if (error) throw new Error(`The request could not be sent. Please try again, or call ${itContact()}.`);
  if (!data.ok) throw new Error((REFUSALS[data.reason] ?? (() => `The request was not accepted. Please call ${itContact()}.`))());
  return {
    requestId: data.request_id, createdAt: data.created_at, name: fields.name, department: fields.department,
    assetType: fields.asset_type, urgency: fields.urgency, photoCount: urls.length, justification: fields.justification,
  };
}

export default function PublicRequestPage() {
  const [receipt, setReceipt] = useState(null);
  const [formKey, setFormKey] = useState(0);
  return (
    <PublicPage title={receipt ? "Request sent" : "Request equipment"}
      subtitle={receipt ? "IT has received your request." : "Ask the IT Department for hardware. No login needed."}>
      {receipt ? (
        <RequestReceipt receipt={receipt} onAnother={() => { setReceipt(null); setFormKey((k) => k + 1); }} />
      ) : (
        <Card className="p-4 sm:p-6">
          <RequestForm key={formKey} onSubmit={submitPublicRequest} onDone={setReceipt} />
        </Card>
      )}
      {!receipt && (
        <p className="mt-4 text-center text-sm text-muted">
          Already sent one? <a href="/status/" className="font-medium text-brand">Track your request</a>
        </p>
      )}
    </PublicPage>
  );
}
