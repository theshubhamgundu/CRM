import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { getValidCalendlyToken } from '@/lib/calendly'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function verifySignature(body: string, signatureHeader: string | null, signingKey: string) {
  if (!signatureHeader) return false

  const parts = signatureHeader.split(',')
  const tPart = parts.find(p => p.startsWith('t='))
  const vPart = parts.find(p => p.startsWith('v1='))

  if (!tPart || !vPart) return false

  const t = tPart.split('=')[1]
  const v1 = vPart.split('=')[1]

  // Prevent replay attacks (within 5 minutes)
  const timestamp = parseInt(t, 10)
  if (isNaN(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) {
    console.warn('Calendly webhook timestamp verification failed.')
    return false
  }

  const payload = `${t}.${body}`

  const expectedSignature = crypto
    .createHmac('sha256', signingKey)
    .update(payload)
    .digest('hex')

  return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expectedSignature))
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('calendly-webhook-signature')

  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY
  if (!signingKey) {
    console.error('CALENDLY_WEBHOOK_SIGNING_KEY not configured')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  if (!verifySignature(body, sig, signingKey)) {
    console.error('Invalid Calendly webhook signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let eventObj: any
  try {
    eventObj = JSON.parse(body)
  } catch (err) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { event, payload } = eventObj

  if (event === 'invitee.created') {
    const inviteeName = payload.name || `${payload.first_name || ''} ${payload.last_name || ''}`.trim() || 'Anonymous'
    const inviteeEmail = payload.email
    
    let inviteePhone = payload.text_reminder_number || ''
    if (!inviteePhone && payload.questions_and_answers && Array.isArray(payload.questions_and_answers)) {
      const phoneQA = payload.questions_and_answers.find((qa: any) => {
        const q = qa.question.toLowerCase()
        return q.includes('phone') || q.includes('mobile') || q.includes('contact')
      })
      if (phoneQA && phoneQA.answer) {
        inviteePhone = phoneQA.answer
      }
    }

    const eventUri = payload.event

    let eventName = 'Scheduled Call'
    let startTime = ''

    // Fetch scheduled event details using Calendly API
    try {
      const token = await getValidCalendlyToken()
      if (token) {
        const response = await fetch(eventUri, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        })

        if (response.ok) {
          const resData = await response.json()
          eventName = resData.resource.name || eventName
          startTime = resData.resource.start_time
            ? new Date(resData.resource.start_time).toLocaleString('en-GB', { timeZone: 'Europe/London' }) + ' (UK Time)'
            : ''
        } else {
          console.error('Failed to fetch scheduled event details:', await response.text())
        }
      }
    } catch (apiErr) {
      console.error('Error calling Calendly API for event details:', apiErr)
    }

    // Compile questions and answers
    let notes = `Scheduled Call: ${eventName}\n`
    if (startTime) notes += `Time: ${startTime}\n`
    notes += `\nQuestions & Answers:\n`

    if (payload.questions_and_answers && Array.isArray(payload.questions_and_answers)) {
      payload.questions_and_answers.forEach((qa: any) => {
        notes += `- Q: ${qa.question}\n  A: ${qa.answer || 'No answer'}\n\n`
      })
    }

    // Retrieve default business mapping
    const { data: defaultBizSetting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'calendly_default_business_id')
      .single()

    let businessId = defaultBizSetting?.value

    if (!businessId) {
      // Fallback: search for business with domain 'landregistrytransfers.com'
      const { data: biz } = await supabase
        .from('businesses')
        .select('id')
        .eq('domain', 'landregistrytransfers.com')
        .single()
      businessId = biz?.id
    }

    if (!businessId) {
      // Second fallback: get first business
      const { data: bizs } = await supabase
        .from('businesses')
        .select('id')
        .limit(1)
      businessId = bizs?.[0]?.id
    }

    // Insert enquiry
    const { error: insertErr } = await supabase.from('enquiries').insert({
      customer_name: inviteeName,
      email: inviteeEmail,
      phone: inviteePhone,
      message: `Booked: ${eventName} ${startTime ? 'on ' + startTime : ''}`,
      source: 'Calendly',
      pipeline_stage: 'new',
      business_id: businessId,
      notes: notes,
    })

    if (insertErr) {
      console.error('Error inserting enquiry from Calendly:', insertErr)
      return NextResponse.json({ error: 'Database save error' }, { status: 500 })
    }

    console.log(`Successfully recorded Calendly enquiry for ${inviteeEmail}`)
  }

  if (event === 'invitee.canceled') {
    const inviteeEmail = payload.email

    // Find latest enquiry with this email
    const { data: enqs } = await supabase
      .from('enquiries')
      .select('id')
      .eq('email', inviteeEmail)
      .order('created_at', { ascending: false })
      .limit(1)

    if (enqs && enqs.length > 0) {
      const enquiryId = enqs[0].id
      const cancelReason = payload.cancellation?.reason || 'No reason provided'
      
      // Add enquiry note about cancellation
      const { error: noteErr } = await supabase.from('enquiry_notes').insert({
        enquiry_id: enquiryId,
        message: `❌ Calendly call cancelled. Reason: ${cancelReason}`,
      })

      if (noteErr) {
        console.error('Error inserting cancellation note:', noteErr)
      } else {
        console.log(`Recorded cancellation note for enquiry ID ${enquiryId}`)
      }
    } else {
      console.log(`No active enquiry found to cancel for email ${inviteeEmail}`)
    }
  }

  return NextResponse.json({ received: true })
}
