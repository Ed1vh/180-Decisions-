import { useState, useEffect, useRef, useCallback } from "react";

// ─── ACCURATE COUNTRY / UNIT MAPPING (Abbott Diabetes Care Reference Table) ──
const COUNTRY_UNITS = {
  "Algeria":"mg/dL","Argentina":"mg/dL","Australia":"mmol/L","Austria":"mg/dL",
  "Bahrain":"mg/dL","Bangladesh":"mg/dL","Belgium":"mg/dL","Brazil":"mg/dL",
  "Canada":"mmol/L","Caribbean Countries":"mg/dL","Chile":"mg/dL","China":"mmol/L",
  "Colombia":"mg/dL","Czech Republic":"mmol/L","Denmark":"mmol/L","Ecuador":"mg/dL",
  "Egypt":"mg/dL","Finland":"mmol/L","France":"mg/dL","Georgia":"mg/dL",
  "Germany":"mmol/L","Greece":"mg/dL","Hong Kong":"mmol/L","India":"mg/dL",
  "Indonesia":"mg/dL","Ireland":"mmol/L","Israel":"mg/dL","Italy":"mg/dL",
  "Japan":"mg/dL","Jordan":"mg/dL","Kazakhstan":"mmol/L","Korea":"mg/dL",
  "Kuwait":"mg/dL","Lebanon":"mg/dL","Luxembourg":"mg/dL","Malaysia":"mmol/L",
  "Malta":"mmol/L","Mexico":"mg/dL","Netherlands":"mmol/L","New Zealand":"mmol/L",
  "Norway":"mmol/L","Oman":"mg/dL","Other":"mmol/L","Peru":"mg/dL",
  "Philippines":"mg/dL","Poland":"mg/dL","Portugal":"mg/dL","Qatar":"mg/dL",
  "Russia":"mmol/L","Saudi Arabia":"mg/dL","Singapore":"mmol/L","Slovakia":"mmol/L",
  "Slovenia":"mmol/L","South Africa":"mmol/L","Spain":"mg/dL","Sub-Saharan Africa":"mg/dL",
  "Sweden":"mmol/L","Switzerland":"mmol/L","Syria":"mg/dL","Taiwan":"mg/dL",
  "Thailand":"mg/dL","Tunisia":"mg/dL","Turkey":"mg/dL","Ukraine":"mmol/L",
  "United Arab Emirates":"mg/dL","United Kingdom":"mmol/L","United States":"mg/dL",
  "Uruguay":"mg/dL","Venezuela":"mg/dL","Vietnam":"mmol/L","Yemen":"mg/dL",
};
const ALL_COUNTRIES = Object.keys(COUNTRY_UNITS).sort();
const usesMmol = c => COUNTRY_UNITS[c] === "mmol/L";
const unitLabel = c => COUNTRY_UNITS[c] || "mmol/L";
const toDisplay = (mgdl, c) => usesMmol(c) ? (mgdl / 18.0182).toFixed(1) : Math.round(mgdl);

// Diabetes awareness colours: red = hypo, amber = hyper, green = in range, blue = awareness/brand
const getGlucoseColor = g => g < 70 ? "#DC2626" : g < 80 ? "#EF4444" : g <= 180 ? "#16A34A" : g <= 250 ? "#D97706" : "#DC2626";

const formatDuration = ms => {
  if (!ms || ms < 0) return "0m";
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), mn = m % 60;
  return h > 0 ? `${h}h ${mn}m` : `${mn}m`;
};
const formatPct = (n, t) => t > 0 ? Math.round((n / t) * 100) : 0;

const OCCUPATIONS = [
  "Student","Teacher / Professor","Healthcare Worker","Office / Desk Job",
  "Politician / Public Figure","Tradesperson / Physical Labour","Parent / Caregiver","Other",
];

// ─── SOUND ────────────────────────────────────────────────────────────────────
const playAlert = (type = "low") => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const p = {
      critical:[[880,0,.12,.8],[880,.16,.12,.8],[660,.32,.12,.8],[880,.48,.12,.8],[660,.64,.22,.9]],
      low:[[880,0,.18,.6],[660,.22,.18,.6],[880,.44,.18,.6],[660,.66,.28,.7]],
      high:[[660,0,.22,.5],[770,.28,.22,.5],[880,.56,.28,.55]],
      nudge:[[440,0,.12,.3],[550,.18,.18,.3]],
    };
    (p[type] || p.nudge).forEach(([freq,start,dur,vol]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq; osc.type = "sine";
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + .02);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + .05);
    });
    setTimeout(() => ctx.close(), 2000);
  } catch (e) {}
};
const vibrate = p => { if (navigator.vibrate) navigator.vibrate(p); };
const alertSensory = tag => {
  if (tag === "CRITICAL") { playAlert("critical"); vibrate([500,100,500,100,500,100,800]); }
  else if (tag === "LOW" || tag === "NIGHT") { playAlert("low"); vibrate([300,100,300,100,500]); }
  else if (tag === "HIGH") { playAlert("high"); vibrate([200,100,200]); }
  else { playAlert("nudge"); vibrate([150,80,150]); }
};

// ─── INSULIN CALCULATOR ───────────────────────────────────────────────────────
// 500 Rule (ICR) and 1800 Rule (ISF): Walsh and Roberts, 1994;
// Davidson et al., 2003; UCSF Diabetes Teaching Center.
const calcInsulin = ({ carbs, fiber, fat, currentGlucose, workoutProximityMins, workoutType }) => {
  const netCarbs = Math.max(0, carbs - fiber);
  const baseUnits = netCarbs / 10;
  const fatNote = fat > 20 ? `High fat (${fat}g) delays glucose peak by 1 to 3 hours. Consider a small correction 90 mins after eating.` : null;
  let workoutAdj = 0, workoutNote = null;
  if (workoutProximityMins !== null && workoutProximityMins <= 120) {
    if (workoutType === "cardio") {
      workoutAdj = -baseUnits * .40;
      workoutNote = `Cardio in ~${Math.round(workoutProximityMins)} min. Reduce dose by about 40%.`;
    } else {
      workoutAdj = -baseUnits * .20;
      workoutNote = `Strength training in ~${Math.round(workoutProximityMins)} min. Reduce dose by about 20%. Watch for delayed lows.`;
    }
  }
  const correctionUnits = (currentGlucose - 100) / 50;
  const totalRecommended = Math.max(0, baseUnits + workoutAdj + correctionUnits);
  return {
    netCarbs,
    baseUnits: Math.round(baseUnits * 10) / 10,
    workoutAdj: Math.round(workoutAdj * 10) / 10,
    correctionUnits: Math.round(correctionUnits * 10) / 10,
    totalRecommended: Math.round(totalRecommended * 10) / 10,
    fatNote, workoutNote,
    breakdown: [
      { label: `Carb dose (${netCarbs}g net carbs / 10)`, val: `${Math.round(baseUnits * 10) / 10}u` },
      workoutAdj !== 0 && { label: "Exercise adjustment", val: `${Math.round(workoutAdj * 10) / 10}u` },
      correctionUnits !== 0 && { label: "Glucose correction", val: `${correctionUnits > 0 ? "+" : ""}${Math.round(correctionUnits * 10) / 10}u` },
    ].filter(Boolean),
    citation: "500 Rule (ICR) and 1800 Rule (ISF): Walsh and Roberts, 1994; Davidson et al., 2003; UCSF Diabetes Teaching Center",
  };
};

// ─── HEALTH SCORING ───────────────────────────────────────────────────────────
const calcHealthScore = metrics => {
  const { mealDecisions, alertDecisions, totalAlerts } = metrics;
  let score = 100;
  const missed = alertDecisions.filter(d => d.selected === -1).length;
  const wrong = alertDecisions.filter(d => d.selected !== -1 && !d.correct).length;
  const correct = alertDecisions.filter(d => d.correct).length;
  score -= missed * 2.5; score -= wrong * 1.5; score += Math.min(10, correct * .5);
  let overdoses = 0, underdoses = 0;
  for (const m of mealDecisions) {
    const pct = m.recommended > 0 ? Math.abs(m.insulinTaken - m.recommended) / m.recommended : Math.abs(m.insulinTaken - m.recommended);
    if (pct <= .1) score += 2;
    else if (pct <= .25) score += 1;
    else if (m.insulinTaken > m.recommended * 1.5) { score -= 4; overdoses++; }
    else if (m.insulinTaken < m.recommended * .5) { score -= 2; underdoses++; }
    else score -= 2;
  }
  score = Math.max(0, Math.min(100, score));
  const a1cPenalty = (underdoses * .3) + (overdoses * .1) + (missed * .15) + (wrong * .1);
  return {
    overall: Math.round(score),
    alertAccuracy: totalAlerts > 0 ? formatPct(correct, totalAlerts) : 0,
    mealAccuracy: mealDecisions.length > 0 ? formatPct(mealDecisions.filter(m => Math.abs(m.insulinTaken - m.recommended) / Math.max(m.recommended, 1) <= .25).length, mealDecisions.length) : null,
    overdoses, underdoses, missed,
    estimatedA1c: Math.min(14, 6.5 + a1cPenalty).toFixed(1),
    mealCount: mealDecisions.length,
  };
};

// ─── CONSEQUENCE TIMELINE ─────────────────────────────────────────────────────
// Source: DCCT/EDIC Research Group (1993 to 2016); NEJM 2000; Diabetes Care 2014.
const getTimeline = (score, a1c) => {
  const a = parseFloat(a1c);
  if (score >= 80 && a < 7.5) return {
    label: "Well Managed",
    citation: "DCCT/EDIC Research Group. Diabetes Care, 2014; New England Journal of Medicine, 2000.",
    items: [
      { year: "1 to 2 yrs", consequence: "Anxiety and cognitive load", title: "The weight sets in", desc: "Even with good control, 30% of T1D patients develop clinical anxiety within the first year. The decisions never stop." },
      { year: "5 yrs", consequence: "Early retinal changes", title: "Screening changes", desc: "Around 1 in 7 patients show early retinal changes at routine eye exams, even with good control." },
      { year: "10 yrs", consequence: "Invisible cumulative cost", title: "Manageable, with effort", desc: "Organ function is largely preserved. But 180 decisions a day, every day, for a decade, has a cost the numbers do not show." },
      { year: "20 yrs", consequence: "Cardiovascular and kidney risk", title: "Wear accumulates", desc: "Two decades of T1D raise cardiovascular risk and cause early changes to kidneys and eyes even in well-managed patients. The DCCT showed intensive therapy reduces but does not eliminate this." },
      { year: "30 yrs", consequence: "Reduced life expectancy", title: "The long view", desc: "Well-controlled T1D is still associated with 10 to 15 years less life expectancy, primarily from heart disease. This is the ceiling of what current treatment offers." },
    ],
  };
  if (score >= 55 && a < 9) return {
    label: "Inconsistent Control",
    citation: "DCCT/EDIC Research Group. Diabetes Care, 2014; New England Journal of Medicine, 2000.",
    items: [
      { year: "1 yr", consequence: "Burnout and distress", title: "Burnout takes hold", desc: "Managing T1D imperfectly is not a character flaw. Diabetes distress affects 45% of patients. It is a predictable consequence of the disease." },
      { year: "3 yrs", consequence: "Nerve damage begins", title: "Nerves begin to change", desc: `At an estimated HbA1c of ${a}%, around 40% of patients notice tingling or numbness in their feet. It is often dismissed as something else.` },
      { year: "5 yrs", consequence: "Vision deteriorating", title: "Sight at risk", desc: "Around 60% probability of detectable retinal damage at this stage. Laser treatment or regular eye injections may now be required." },
      { year: "10 yrs", consequence: "Kidney function declining", title: "Kidneys under strain", desc: "Kidney filtration measurably declines. Dietary restrictions begin. The DCCT linked this directly to HbA1c levels sustained over years." },
      { year: "20 yrs", consequence: "Organ failure and blindness", title: "Multiple systems affected", desc: "Nerve damage, kidney decline, and retinal disease are all likely present. Heart disease risk is 2 to 4 times the general population." },
    ],
  };
  return {
    label: "Poor Control",
    citation: "DCCT/EDIC Research Group. Diabetes Care, 2014; New England Journal of Medicine, 2000.",
    items: [
      { year: "6 months", consequence: "Hospitalisation risk", title: "Crisis risk", desc: "This pattern is associated with hospitalisation for diabetic ketoacidosis in over 30% of T1D patients per year. Each episode stresses the body." },
      { year: "2 yrs", consequence: "Silent organ damage", title: "Silent damage", desc: "High glucose damages the vessels feeding the retinas, kidneys, and nerves, without any symptoms. By the time damage is felt, it has been building for years." },
      { year: "5 yrs", consequence: "Partial or full blindness", title: "Vision threatened", desc: "Fragile new blood vessels can bleed into the retina. Without treatment, this progresses to partial or complete blindness in a meaningful proportion of cases." },
      { year: "10 yrs", consequence: "Dialysis likely", title: "Kidney failure", desc: "Dialysis, three sessions per week, four hours each, becomes necessary for around 1 in 4 patients at this trajectory." },
      { year: "15 yrs", consequence: "Amputation, blindness, heart failure", title: "Life fundamentally changed", desc: "Amputations, dialysis, blindness, and heart disease intersect. Every early decision compounds across a lifetime." },
    ],
  };
};

// ─── ALERT POOL ───────────────────────────────────────────────────────────────
const ALERT_POOL = [
  {
    id: "crit_low", glucose: 52, status: "CRITICAL LOW", statusColor: "#DC2626", tag: "CRITICAL", type: "cgm",
    contexts: { default: "You are in the middle of something.", meeting: "Mid-presentation. All eyes on you.", workout: "Mid-workout, alone.", sleep: "3:12am. You were asleep.", social: "At a restaurant, mid-meal." },
    questions: {
      default: "Glucose 52. You feel shaky and confused. What do you do?",
      sleep: "3:12am. Your alarm woke you. Glucose is 52 and still dropping. What do you do?",
    },
    options: {
      default: [
        { text: "Eat the fastest carbs available now", correct: true, feedback: "Fast-acting carbs only. At 52 you have a narrow window before your body stops cooperating." },
        { text: "Eat a balanced snack to stabilise slowly", correct: false, feedback: "Protein slows glucose absorption. At this level you need sugar in your blood in minutes, not half an hour." },
        { text: "Take a small insulin correction to prevent the rebound high", correct: false, feedback: "Any insulin right now is dangerous. The urge to prevent a later high is understandable. But insulin at 52 could put you on the floor." },
        { text: "Sit down and wait to see if it stabilises", correct: false, feedback: "It will not stabilise on its own. The insulin already in your system keeps acting. Waiting turns a manageable low into a medical emergency." },
      ],
      sleep: [
        { text: "Eat nearby carbs and stay awake 15 minutes to confirm the rise", correct: true, feedback: "Correct. Staying awake to confirm glucose is rising is what separates a treated low from a dangerous one." },
        { text: "Take a small correction to prevent the rebound high that usually follows", correct: false, feedback: "Taking insulin during a low can be fatal. Treat the low first. Handle the rebound separately, if it happens." },
        { text: "Eat a full snack and go back to sleep", correct: false, feedback: "Going back to sleep before confirming the rise is one of the main causes of nocturnal deaths in T1D patients." },
        { text: "Set an alarm for 30 minutes and go back to sleep without eating", correct: false, feedback: "At 52 and dropping, 30 minutes without treatment is dangerous." },
      ],
    },
    science: "At 52 mg/dL, the prefrontal cortex is among the first brain regions to lose function. The organ you need to make this decision is the one being damaged right now.",
    scienceSource: "Cryer PE. Hypoglycaemia in Diabetes. American Diabetes Association, 2009.",
  },
  {
    id: "low_recheck", glucose: 68, status: "LOW", statusColor: "#EF4444", tag: "LOW", type: "cgm",
    contexts: { default: "You treated 15 minutes ago. Glucose now reads 71.", meeting: "You treated during a break. Back in the meeting. Now 71.", workout: "Treated pre-workout. Now 71, flat trend.", sleep: "3am. You treated a low 20 minutes ago. Glucose is now 71.", social: "Treated at the table 15 minutes ago. Now 71." },
    questions: {
      default: "You treated 15 minutes ago. Glucose is 71 and flat. What do you do?",
      sleep: "3am. You treated a low 20 minutes ago. Glucose is 71 and not moving. What do you do?",
    },
    options: {
      default: [
        { text: "Wait 15 more minutes before deciding", correct: true, feedback: "The 15-15 rule: 15g carbs, wait 15 minutes, recheck. Stacking more carbs now before the first dose absorbs causes a rebound high you will spend the next hour managing." },
        { text: "Eat another full portion to be sure", correct: false, feedback: "Over-treating is one of the most common hypoglycaemia errors. The rebound high from stacking carbs is its own problem." },
        { text: "Take a small insulin to blunt the coming rebound", correct: false, feedback: "At 71, insulin is still dangerous. The carbs from 15 minutes ago may still be raising glucose." },
        { text: "71 is above 70. Resume normal activity.", correct: false, feedback: "A flat trend at this level with active insulin means the direction matters more than the number." },
      ],
      sleep: [
        { text: "Wait 15 more minutes. Confirm it is rising before sleeping.", correct: true, feedback: "Sleep removes your ability to detect symptoms. Returning to sleep at a flat 71 with active overnight insulin is the scenario associated with nocturnal events." },
        { text: "71 is above 70. Safe to sleep.", correct: false, feedback: "A flat trend at 3am with active basal insulin means 71 can become 54 within the hour." },
        { text: "Eat more to push it above 90 first", correct: false, feedback: "Over-treating at night causes a rebound high. You will be awake again in 2 to 3 hours managing it." },
        { text: "Set a 2-hour alarm and sleep now", correct: false, feedback: "2 hours is too long. With active insulin and a flat trend at 71, the window for it to drop is well under 2 hours." },
      ],
    },
    science: "The 15-15 rule is clinically established but frequently misapplied. Over-treating hypoglycaemia creates a rebound high, which requires more insulin, which risks another low. This cycle compounds sleep disruption and decision fatigue night after night.",
    scienceSource: "American Diabetes Association. Standards of Medical Care in Diabetes, 2023.",
  },
  {
    id: "high_complex", glucose: 224, status: "HIGH", statusColor: "#D97706", tag: "HIGH", type: "cgm",
    contexts: { default: "You are trying to concentrate.", meeting: "You are leading a 90-minute meeting. 40 minutes in.", workout: "You just finished your warmup.", sleep: "2:30am. Your alarm woke you. You are alone.", social: "Dinner party, mid-conversation." },
    questions: {
      default: "Glucose 224 and rising. What do you do?",
      sleep: "2:30am. Your alarm woke you. Glucose is 224 and rising slowly. What do you do?",
      meeting: "Glucose 224 mid-meeting. 50 minutes left.",
    },
    options: {
      default: [
        { text: "Take a correction dose now and monitor", correct: true, feedback: "Sustained high glucose causes both immediate cognitive impairment and long-term damage. Prompt correction with a recheck is the right call." },
        { text: "Wait until the current activity ends", correct: false, feedback: "Every 30 minutes at 224 contributes to measurable cognitive impairment and cumulative vascular damage. The DCCT documented this relationship directly." },
        { text: "Take a larger correction to bring it down faster", correct: false, feedback: "Aggressive correction causes dangerous lows 2 to 4 hours later. The correction formula exists to prevent exactly this." },
        { text: "Eat some protein to help stabilise", correct: false, feedback: "Protein does not lower glucose. At 224 and rising, eating anything without insulin makes it worse." },
      ],
      sleep: [
        { text: "Take a measured correction, set a 2-hour alarm, go back to sleep", correct: true, feedback: "A measured correction with a recheck alarm is the right balance. The recheck is not optional." },
        { text: "224 is not dangerous. Check in the morning.", correct: false, feedback: "Sustained overnight hyperglycaemia causes vascular damage silently during sleep. 224 for 6 to 7 hours is meaningful accumulated exposure." },
        { text: "Take a full correction and sleep", correct: false, feedback: "Overnight overcorrection is one of the most dangerous T1D scenarios. Insulin sensitivity changes during sleep. A daytime dose can drive glucose critically low by 4am." },
        { text: "Eat a small snack to balance the correction", correct: false, feedback: "Glucose is already 224. Eating before correcting raises it further." },
      ],
      meeting: [
        { text: "Correct now. The cognitive cost of staying high outweighs the social cost.", correct: true, feedback: "At 224 and rising, your working memory is already impaired. The meeting is going worse than it would if you corrected. The social cost of a discreet dose is lower than the cost of not taking it." },
        { text: "Wait until the meeting ends. 50 minutes is manageable.", correct: false, feedback: "50 minutes at 224 and rising means you will likely peak above 280 before you can correct. The impairment is already affecting the meeting you are trying to protect." },
        { text: "Excuse yourself to correct privately", correct: false, feedback: "Medically reasonable, but leaving mid-meeting has its own cost. No option here is free. This is the daily calculus of T1D in professional settings." },
        { text: "Take a larger dose to resolve it faster", correct: false, feedback: "Aggressive correction risks a significant low in 2 to 3 hours, possibly while driving home. Overcorrection is a common and dangerous pattern." },
      ],
    },
    science: "Research shows cognitive performance at high glucose levels is measurably reduced even when the person feels fine. This is called hyperglycaemic unawareness.",
    scienceSource: "Sommerfield AJ et al. Acute hyperglycemia alters mood state and impairs cognitive performance in people with type 2 diabetes. Diabetes Care, 2004.",
  },
  {
    id: "social_dose", glucose: 103, status: "IN RANGE", statusColor: "#16A34A", tag: "SOCIAL", type: "cgm",
    contexts: { default: "Dinner just arrived.", meeting: "Lunch at your desk. A colleague stops by.", workout: "Pre-workout snack. Others nearby.", sleep: "Late snack before bed. Alone at home.", social: "Everyone at the dinner table just got their food." },
    questions: {
      default: "Glucose is fine. Food arrived. You need to dose. What do you do?",
      sleep: "Late snack, alone at home. Glucose 103. What do you do?",
      social: "Glucose is fine. Dinner arrived. You need to inject. Everyone is watching.",
    },
    options: {
      default: [
        { text: "Dose at the table. The medical cost of not dosing is higher.", correct: false, feedback: "Medically correct. But 38% of T1D people report stigma in exactly these moments. The medical choice and the emotional cost are not the same thing." },
        { text: "Excuse yourself to dose privately", correct: false, feedback: "Medically acceptable. But leaving the table at every meal is its own quiet exclusion, from the food, the moment, and the group." },
        { text: "Skip this once", correct: false, feedback: "This is how burnout shows up in clinical data. One skipped dose becomes a pattern. Research links social stigma directly to dose omission and long-term complications." },
        { text: "There is no option without a hidden cost", correct: true, feedback: "Dose publicly, social cost. Leave privately, medical and social cost. Skip, clinical cost. This calculation happens at every meal, every day, indefinitely." },
      ],
      sleep: [
        { text: "Dose normally. You are alone. No social calculation needed.", correct: true, feedback: "This is T1D stripped of its social burden. You still need to count carbs, know your glucose, factor in what you have already taken, and calculate the right dose. Simple is relative. But at least the stigma is not part of it tonight." },
        { text: "Skip it. Small snack, already in range.", correct: false, feedback: "Even small amounts of carbohydrate require insulin in T1D. Skipping overnight doses causes silent high glucose, contributing directly to the long-term complications in your trajectory." },
        { text: "Take a slightly higher dose to cover any rise during sleep", correct: false, feedback: "Erring high with overnight insulin is one of the most common causes of nocturnal hypoglycaemia. Conservative dosing overnight is specifically what the evidence supports." },
        { text: "Take your normal mealtime dose regardless of snack size", correct: false, feedback: "A full mealtime dose for a small snack will cause dangerous hypoglycaemia overnight. Insulin must be proportional to carbohydrate content." },
      ],
      social: [
        { text: "Dose visibly. Normalise it.", correct: false, feedback: "The intention is right. The reality is that it requires energy, fielding questions, managing reactions, explaining the same things again. 38% of T1D people report stigma in exactly these settings." },
        { text: "Excuse yourself quietly", correct: false, feedback: "Choosing to hide a medical necessity at every meal, across years, is its own psychological cost. Research links concealment to shame and disengagement from self-care." },
        { text: "Pre-bolus before leaving home to avoid dosing at the table", correct: false, feedback: "Legitimate technique. But at a restaurant with uncertain timing and portion size, early dosing risks hypoglycaemia before the food arrives." },
        { text: "Every option requires something. There is no neutral choice.", correct: true, feedback: "Visibility costs social energy. Privacy costs medical precision. Skipping costs health. Pre-bolusing costs timing certainty. This is every meal with T1D, indefinitely." },
      ],
    },
    science: "Diabetes distress, distinct from clinical depression, is the emotional weight of relentless self-management. It affects up to 45% of T1D patients and is independently linked to higher HbA1c and more complications.",
    scienceSource: "Hessler DM et al. Diabetes distress in adults with type 1 diabetes. Diabetes Care, 2019.",
  },
  {
    id: "alarm_fatigue", glucose: 118, status: "IN RANGE", statusColor: "#16A34A", tag: "FATIGUE", type: "cgm",
    contexts: { default: "Your 6th CGM alert today. Glucose is fine.", meeting: "6th alert. Important meeting.", workout: "6th alert. Mid-run.", sleep: "2:55am. This is the 4th alert tonight. Glucose is fine.", social: "6th alert today. Mid-conversation." },
    questions: {
      default: "6th alert today. Glucose is fine. You consider silencing overnight alerts. What is the risk?",
      sleep: "2:55am. The 4th alert tonight. Glucose is fine again. You are exhausted. You consider silencing the CGM. What do you do?",
    },
    options: {
      default: [
        { text: "Silencing risks missing a real critical low while asleep", correct: true, feedback: "This is the core danger. Silencing CGM alerts is directly linked to delayed treatment of genuine lows. The fatigue is documented and real. So is the risk." },
        { text: "False alarms have no consequences. You can check manually.", correct: false, feedback: "Manual checking requires waking up, which defeats the point. And people who silence alerts tend to stop checking manually too." },
        { text: "Modern CGMs are accurate enough. False alarms are rare.", correct: false, feedback: "Patients still average 8 to 15 alerts per day. Alarm fatigue is a documented clinical syndrome precisely because false positives remain common." },
        { text: "You can re-enable alerts in the morning", correct: false, feedback: "The dangerous event does not wait for a convenient time. The gap between silencing and re-enabling is when critical lows occur." },
      ],
      sleep: [
        { text: "Silencing risks not waking for a real low. The fatigue is real, but so is the risk.", correct: true, feedback: "There is no good option here. Chronic sleep disruption raises cortisol and worsens glucose control. But silencing creates genuine safety risk. This is a Tuesday night for someone with T1D." },
        { text: "4 false alarms means the sensor is malfunctioning. Safe to silence it.", correct: false, feedback: "Multiple alerts may reflect sensor drift or sleeping position. Assuming malfunction and silencing is how people miss real critical events." },
        { text: "You treated every alert tonight. You have done enough.", correct: false, feedback: "Treating previous alerts does not protect against future ones. A glucose at 85 at 2am can be 54 at 4am with active basal insulin." },
        { text: "Set a manual alarm for 3 hours and silence the CGM", correct: false, feedback: "3 hours is too long. Nocturnal hypoglycaemia can become severe in under an hour." },
      ],
    },
    science: "Patients who silence CGM alarms have higher rates of severe hypoglycaemic events. The fatigue is real. The risk of silencing is also real. The disease offers no good options, only tradeoffs.",
    scienceSource: "Gonder-Frederick L et al. Continuous glucose monitoring and alarm fatigue in type 1 diabetes. Diabetes Care, 2022.",
  },
  {
    id: "night_pattern", glucose: 64, status: "LOW", statusColor: "#EF4444", tag: "NIGHT", type: "cgm",
    contexts: { default: "4:20am. This is the second low tonight.", sleep: "4:20am. You are woken by your alarm. This is the second low tonight. You treated at 1:30am." },
    questions: {
      default: "4:20am. Glucose 64 and dropping. This is the second low tonight. What does this mean?",
      sleep: "4:20am. Your alarm woke you. Glucose is 64 and dropping. This is the second low tonight. What do you do?",
    },
    options: {
      default: [
        { text: "Treat with carbs and review your overnight basal rate tomorrow", correct: true, feedback: "Both steps matter. The immediate low needs treatment. Two lows in one night is clinical information. Your overnight basal insulin rate may need adjusting." },
        { text: "Treat with more carbs than usual to build a bigger buffer", correct: false, feedback: "Over-treating leads to a rebound high, then correction, then another potential low. You cannot eat your way out of a basal rate problem." },
        { text: "Skip the treatment. You treated 3 hours ago.", correct: false, feedback: "Glucose at 64 and dropping needs treatment regardless of cause. Identify the pattern later. Treat the immediate situation now." },
        { text: "Eat a full meal to prevent a third low", correct: false, feedback: "A full meal at 4am causes significant high glucose, then requires correction, which risks another low." },
      ],
      sleep: [
        { text: "Treat with 15g fast carbs, then review your overnight insulin in the morning", correct: true, feedback: "The immediate low needs treatment now. Two nocturnal lows in one night means your overnight basal rate likely needs adjustment. Treating symptoms without addressing the pattern means this repeats tomorrow." },
        { text: "Eat enough to push glucose well above 100", correct: false, feedback: "Over-treating causes a rebound high, then morning correction, then another potential swing. More carbs now does not fix a basal insulin problem." },
        { text: "Do not treat. Your body will stabilise once the earlier insulin finishes.", correct: false, feedback: "Insulin timelines are not precise enough to rely on. At 64 and dropping, waiting risks reaching a level where you cannot treat yourself." },
        { text: "Take a small insulin to prevent the rebound high after you treat", correct: false, feedback: "Taking insulin during a low is how people end up with critical lows. Treat first. If a rebound occurs, manage it when glucose is safely above 80." },
      ],
    },
    science: "Repeat nocturnal hypoglycaemia disrupts sleep, raises cortisol, worsens insulin resistance the next day, and blunts the body's ability to detect lows over time, making each subsequent low harder to notice.",
    scienceSource: "Schultes B et al. Nocturnal hypoglycaemia and sleep disruption in type 1 diabetes. Diabetes Technology and Therapeutics, 2007.",
  },
  {
    id: "stress_glucose", glucose: 186, status: "RISING", statusColor: "#D97706", tag: "STRESS", type: "cgm",
    contexts: { default: "Stressed. Have not eaten. Glucose climbing.", meeting: "Big presentation in 30 minutes. Glucose rising without food.", sleep: "Cannot sleep. Anxious. Glucose slowly rising.", social: "A difficult conversation. Glucose climbing." },
    questions: { default: "Glucose 186 and rising. No food involved. Stress hormones are causing it. How do you correct?" },
    options: {
      default: [
        { text: "Small conservative correction, then monitor", correct: true, feedback: "Stress hormones can raise glucose sharply and then drop rapidly as stress resolves. A full correction dose taken at the peak causes a significant low 2 to 3 hours later." },
        { text: "Full correction. A high is a high.", correct: false, feedback: "The cause matters for the size of the correction. Stress highs often resolve faster than meal highs. A full correction at the peak risks a dangerous low when the hormones clear." },
        { text: "Wait. Let the stress pass and glucose normalise.", correct: false, feedback: "At 186 and rising, some correction is warranted. Waiting risks reaching 250 where cognitive impairment becomes significant." },
        { text: "Exercise to metabolise the stress glucose without insulin", correct: false, feedback: "Exercise during acute stress raises cortisol and adrenaline further, which can paradoxically raise glucose more." },
      ],
    },
    science: "Cortisol directly raises blood glucose by triggering glucose release from the liver. For T1D patients, every stressful moment has a physiological glucose consequence requiring active management. Emotional events are metabolic events.",
    scienceSource: "Surwit RS et al. Stress and diabetes mellitus. Diabetes Care, 1992.",
  },
];

// ─── DRIVING + EXERCISE ───────────────────────────────────────────────────────
const buildDrivingScenario = (country, glucose) => {
  const safe = glucose >= 90;
  const display = toDisplay(glucose, country);
  const unit = unitLabel(country);
  const minSafe = usesMmol(country) ? "5.0" : "90";
  return {
    type: "driving", glucose, statusColor: safe ? "#16A34A" : "#DC2626",
    title: safe ? "Pre-Drive Check" : "You Cannot Drive Right Now",
    subtitle: safe
      ? `Glucose ${display} ${unit}. Above the minimum safe driving threshold.`
      : `Glucose ${display} ${unit}. Below the safe threshold of ${minSafe} ${unit}. Driving risks loss of consciousness at the wheel.`,
    question: safe
      ? `Glucose ${display} ${unit}. Safe to drive. 90-minute trip ahead. What do you do?`
      : `Glucose ${display} ${unit}. You cannot safely drive. What do you do?`,
    options: safe ? [
      { text: "Drive immediately. You are in range.", correct: false, feedback: "In-range glucose now does not mean in-range glucose in 45 minutes. Driving-related muscle activity and elapsed time can drop glucose significantly on longer trips." },
      { text: "Put glucose tabs in the car and set a recheck reminder for 45 minutes", correct: true, feedback: "T1D and safe driving are compatible. The evidence-based approach is accessible fast carbs and a mid-trip recheck, not avoidance." },
      { text: "Eat a full meal before leaving to stabilise for the whole trip", correct: false, feedback: "A full pre-trip meal creates its own insulin timing challenge. Accessible fast carbs and a mid-trip recheck is the clinical recommendation." },
      { text: "Do not drive. Any risk while driving is unacceptable.", correct: false, feedback: "This overcorrects. Well-managed T1D is compatible with driving. The goal is preparation, not avoidance." },
    ] : [
      { text: "Drive anyway. You feel okay and it is a short trip.", correct: false, feedback: "Feeling okay during hypoglycaemia is itself a symptom. Reduced self-awareness is a documented feature of low glucose impairment. Feeling fine at this level is not reliable information." },
      { text: "Treat with fast carbs, wait 15 minutes, confirm glucose before driving", correct: true, feedback: "Treatment first, confirmed rise second, then drive. The 15-minute wait matters. Glucose needs time to rise and brain function needs time to recover." },
      { text: "Have someone else drive while you eat carbs in the passenger seat", correct: false, feedback: "Reasonable in an emergency, but you still need to treat the low and confirm recovery before driving again." },
      { text: "T1D means you should not be driving at all", correct: false, feedback: "A harmful misconception. People with well-managed T1D drive safely everywhere. The issue is glucose level at time of driving, not the diagnosis." },
    ],
    science: "Reaction time, hazard perception, and lane-keeping are measurably impaired during hypoglycaemia, often before the driver notices anything is wrong. This is the basis for glucose-based driving regulations.",
    scienceSource: "Cox DJ et al. Driving mishaps among individuals with type 1 diabetes. Diabetes Care, 2009.",
  };
};

const buildExerciseScenario = (country, glucose, exerciseType) => {
  const display = toDisplay(glucose, country);
  const unit = unitLabel(country);
  const low = glucose < 90, high = glucose > 180;
  const typeLabel = exerciseType === "cardio" ? "a cardio session" : exerciseType === "strength" ? "strength training" : "mixed training";
  return {
    type: "exercise", glucose, statusColor: getGlucoseColor(glucose),
    title: "Pre-Exercise Decision",
    subtitle: `About to do ${typeLabel}. Glucose: ${display} ${unit}.`,
    question: `Glucose ${display} ${unit} before ${typeLabel}. What do you do?`,
    options: low ? [
      { text: "15 to 20g fast carbs, wait 15 minutes, recheck before starting", correct: true, feedback: "You need glucose in your bloodstream before muscles start consuming more. Starting below 5.0 mmol/L (90 mg/dL) risks a dangerous low during the session." },
      { text: "Start with a light warmup while eating", correct: false, feedback: "Carbs take 15 to 20 minutes to raise blood glucose. Starting exercise simultaneously means glucose keeps dropping while you need it to rise." },
      { text: "Reduce your next insulin dose. That is the real problem.", correct: false, feedback: "Reducing future insulin does not help your current glucose. The insulin from earlier is already active. You cannot undo it." },
      { text: "Push through. Exercise often raises glucose.", correct: false, feedback: "Aerobic exercise typically lowers glucose. Starting below 90 mg/dL means you are likely to drop into dangerous territory within 15 to 20 minutes." },
    ] : high ? [
      { text: "Correction dose, wait 30 to 60 minutes, then light exercise only", correct: true, feedback: "Above 14 mmol/L (250 mg/dL), high-intensity exercise can raise glucose further via stress hormones. Correct first, do light activity, check for ketones if unwell." },
      { text: "Exercise will bring it down. Skip the insulin.", correct: false, feedback: "High-intensity exercise during hyperglycaemia can paradoxically raise glucose further. Stress hormones stimulate liver glucose release." },
      { text: "Take your normal pre-workout dose and train as planned", correct: false, feedback: "Glucose is already high. Your normal dose does not account for the existing elevation. Training at 250 without correcting first risks pushing glucose higher." },
      { text: "Skip the workout entirely", correct: false, feedback: "Light exercise is safe and potentially helpful. It is high-intensity training that carries risk during hyperglycaemia." },
    ] : exerciseType === "cardio" ? [
      { text: "Reduce basal insulin and eat 15 to 30g slow-acting carbs before starting", correct: true, feedback: "Aerobic exercise increases glucose uptake by muscles, independent of insulin. Without adjustment you are likely heading for a mid-session low." },
      { text: "Glucose is in range. No adjustment needed.", correct: false, feedback: "In-range now does not mean in-range in 30 minutes. Aerobic exercise can drop glucose by 2 to 4 mmol/L (35 to 70 mg/dL) over a session without adjustment." },
      { text: "Take extra insulin to handle the spike from exertion", correct: false, feedback: "Aerobic exercise lowers, not raises, blood glucose. Extra insulin before cardio is one of the most reliable ways to end up with a severe mid-workout low." },
      { text: "Eat a large carb-heavy meal for sustained fuel", correct: false, feedback: "A large pre-workout meal creates complex insulin timing challenges. Modest carbohydrate supplementation and reduced insulin is the evidence-based approach." },
    ] : [
      { text: "Slightly reduce your next insulin dose and monitor for delayed lows tonight", correct: true, feedback: "Strength training raises glucose during the session via stress hormones, then lowers it for 4 to 8 hours as muscles replenish. The delayed low is the more dangerous risk." },
      { text: "Glucose is in range. No adjustment needed.", correct: false, feedback: "The immediate reading matters less than the trajectory. Strength training increases insulin sensitivity for hours afterward. Without monitoring, a delayed low is a common outcome." },
      { text: "Load extra carbs before lifting. The intensity will burn through them.", correct: false, feedback: "Strength training often raises glucose during the session. Pre-loading carbs adds a high before the delayed low." },
      { text: "Take extra insulin before training to counteract the expected rise", correct: false, feedback: "Extra insulin taken before strength training risks significant hypoglycaemia 4 to 6 hours later, when insulin sensitivity peaks." },
    ],
    science: exerciseType === "cardio"
      ? "Aerobic exercise increases glucose uptake by working muscles, independent of insulin. Beneficial long term, but requires careful management to prevent dangerous drops during the session."
      : "Resistance exercise temporarily raises glucose via stress hormones. The subsequent increase in insulin sensitivity as muscles replenish glycogen can cause significant delayed hypoglycaemia hours after training.",
    scienceSource: exerciseType === "cardio"
      ? "Riddell MC et al. Exercise management in type 1 diabetes. Lancet Diabetes and Endocrinology, 2017."
      : "Yardley JE et al. Resistance exercise in type 1 diabetes. Diabetes Care, 2013.",
  };
};

const MEAL_CONTEXTS = {
  breakfast: { label: "Breakfast", desc: "What you eat now sets the glucose curve for the next 3 hours." },
  lunch: { label: "Lunch", desc: "Insulin from breakfast may still be active." },
  dinner: { label: "Dinner", desc: "This meal affects your overnight glucose." },
  snack: { label: "Snack", desc: "Even small amounts of carbohydrate require consideration." },
};

// ─── SCIENCE DROPDOWN COMPONENT ───────────────────────────────────────────────
const ScienceDropdown = ({ science, style }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: "10px", ...style }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", padding: "8px 12px", background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(0,200,180,0.25)", borderRadius: open ? "7px 7px 0 0" : "7px",
          color: "#00c8b4", fontSize: "9px", fontWeight: "bold", letterSpacing: "2px",
          cursor: "pointer", textAlign: "left", fontFamily: "-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}
      >
        <span>THE SCIENCE</span>
        <span style={{ fontSize: "10px", color: "#475569" }}>{open ? "v" : ">"}</span>
      </button>
      {open && (
        <div style={{
          padding: "10px 12px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(0,200,180,0.2)",
          borderTop: "none",
          borderRadius: "0 0 7px 7px",
          animation: "fadeIn 0.2s ease",
        }}>
          <div style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.7 }}>{science}</div>
        </div>
      )}
    </div>
  );
};

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("intro");
  const [onboardStep, setOnboardStep] = useState(0);
  const [profile, setProfile] = useState({ name: "", country: "", occupation: "", wakeTime: "07:00", sleepTime: "23:00", events: [], willDrive: false, driveTime: "09:00", willExercise: false, exerciseTime: "17:00", exerciseType: "cardio" });
  const [mode, setMode] = useState(null);
  const [customHours, setCustomHours] = useState(4);
  const [challengeStart, setChallengeStart] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [activeAlert, setActiveAlert] = useState(null);
  const [alertHistory, setAlertHistory] = useState([]);
  const [mealHistory, setMealHistory] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [timeLeft, setTimeLeft] = useState(25);
  const [timerActive, setTimerActive] = useState(false);
  const [tappedOut, setTappedOut] = useState(false);
  const [glucose, setGlucose] = useState(104);
  const [glucoseTrend, setGlucoseTrend] = useState("stable");
  const [mealPhase, setMealPhase] = useState("input");
  const [mealCarbs, setMealCarbs] = useState(45);
  const [mealFiber, setMealFiber] = useState(5);
  const [mealFat, setMealFat] = useState(15);
  const [mealInsulinTaken, setMealInsulinTaken] = useState(3);
  const [mealCalc, setMealCalc] = useState(null);
  const [activeMealType, setActiveMealType] = useState("lunch");
  const [alertCount, setAlertCount] = useState(0);
  const [healthScore, setHealthScore] = useState(null);
  const [mealSimTime, setMealSimTime] = useState(null);

  const intervalRef = useRef(null), alertTimerRef = useRef(null), elapsedRef = useRef(null), glucoseRef = useRef(null);
  const specialRef = useRef({ driving: false, exercise: false, meals: {} });
  const elapsedMs = useRef(0);   // always-current elapsed, safe inside callbacks
  const glucoseVal = useRef(104); // always-current glucose, safe inside callbacks

  const totalMs = mode === "demo" ? 2 * 60000 : mode === "timed" ? customHours * 3600000 : null;

  useEffect(() => {
    if (screen === "challenge" && challengeStart && !tappedOut) {
      elapsedRef.current = setInterval(() => {
        const e = Date.now() - challengeStart;
        setElapsed(e);
        elapsedMs.current = e;
        if (totalMs && e >= totalMs) finishChallenge(true);
      }, 1000);
    }
    return () => clearInterval(elapsedRef.current);
  }, [screen, challengeStart, tappedOut, totalMs]);

  useEffect(() => {
    if (screen === "challenge" && !tappedOut) {
      glucoseRef.current = setInterval(() => {
        setGlucose(g => {
          const d = (Math.random() - .48) * 5;
          const n = Math.max(45, Math.min(350, g + d));
          glucoseVal.current = Math.round(n); // keep ref in sync
          setGlucoseTrend(d > 1.5 ? "rising" : d < -1.5 ? "falling" : "stable");
          return Math.round(n);
        });
      }, mode === "demo" ? 3000 : 30000);
    }
    return () => clearInterval(glucoseRef.current);
  }, [screen, tappedOut, mode]);

  const getMealType = useCallback(pct => {
    const h = pct * 24, wake = parseInt(profile.wakeTime?.split(":")[0] || "7");
    if (h >= wake && h < wake + 2 && !specialRef.current.meals.breakfast) return "breakfast";
    if (h >= 12 && h < 14 && !specialRef.current.meals.lunch) return "lunch";
    if (h >= 18 && h < 20 && !specialRef.current.meals.dinner) return "dinner";
    if (h >= 15 && h < 16 && !specialRef.current.meals.snack) return "snack";
    return null;
  }, [profile.wakeTime]);

  const getDelay = useCallback(pct => {
    const h = pct * 24, sleepH = parseInt(profile.sleepTime?.split(":")[0] || "23"), wakeH = parseInt(profile.wakeTime?.split(":")[0] || "7");
    const isSleep = h >= sleepH || h < wakeH;
    return Math.round(8 * 60000 * (isSleep ? Math.random() * .8 + .9 : Math.random() * 1.2 + .5));
  }, [profile]);

  const scheduleNext = useCallback((cur = 0) => {
    if (intervalRef.current) clearTimeout(intervalRef.current);

    // Helper: format a fractional 24h hour as "H:MMam/pm"
    const fmtSimTime = h => {
      const totalMins = Math.round(h * 60);
      const hh = Math.floor(totalMins / 60) % 24;
      const mm = String(totalMins % 60).padStart(2, "0");
      const ampm = hh < 12 ? "am" : "pm";
      const display = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
      return `${display}:${mm}${ampm}`;
    };

    if (mode === "demo") {
      // Demo slots with fixed simulated times.
      // Slot "meal" triggers the meal screen instead of a CGM alert.
      const DEMO_SLOTS = [
        { atMs: 18000,  alertId: "night_pattern", ctxOverride: "sleep",   simTime: "3:12am"  },
        { atMs: 42000,  alertId: "meal",           ctxOverride: null,      simTime: "7:45am"  },
        { atMs: 75000,  alertId: "high_complex",   ctxOverride: "default", simTime: "12:30pm" },
        { atMs: 105000, alertId: "social_dose",    ctxOverride: "social",  simTime: "7:00pm"  },
        { atMs: 116000, alertId: "contextual",     ctxOverride: null,      simTime: null      },
      ];
      const nextSlot = DEMO_SLOTS.find(s => s.atMs > cur);
      if (!nextSlot) return;
      intervalRef.current = setTimeout(() => {
        const g = glucoseVal.current;

        // Meal slot — trigger meal screen directly
        if (nextSlot.alertId === "meal") {
          specialRef.current.meals.breakfast = true;
          setActiveMealType("breakfast");
          setMealPhase("input");
          setMealCarbs(52); setMealFiber(4); setMealFat(12);
          setMealInsulinTaken(4); setMealCalc(null);
          setMealSimTime(nextSlot.simTime);
          setScreen("meal");
          scheduleNext(nextSlot.atMs);
          return;
        }

        let alert;
        if (nextSlot.alertId === "contextual") {
          if (profile.willDrive && !specialRef.current.driving) {
            specialRef.current.driving = true;
            alert = buildDrivingScenario(profile.country, g);
          } else if (profile.willExercise && !specialRef.current.exercise) {
            specialRef.current.exercise = true;
            alert = buildExerciseScenario(profile.country, g, profile.exerciseType);
          } else {
            alert = ALERT_POOL.find(a => a.id === "alarm_fatigue") || ALERT_POOL[0];
          }
        } else {
          alert = ALERT_POOL.find(a => a.id === nextSlot.alertId) || ALERT_POOL[0];
        }
        if (nextSlot.ctxOverride) alert = { ...alert, _ctxOverride: nextSlot.ctxOverride };
        if (nextSlot.simTime) alert = { ...alert, _simTime: nextSlot.simTime };
        setAlertCount(n => n + 1); alertSensory(alert.tag || "nudge");
        setActiveAlert(alert); setSelected(null); setShowFeedback(false); setTimeLeft(25); setTimerActive(true); setScreen("alert");
      }, nextSlot.atMs - cur);
      return;
    }

    // Non-demo: variable-cadence scheduler
    const delay = getDelay(cur / (totalMs || (24 * 3600000)));
    intervalRef.current = setTimeout(() => {
      if (totalMs && cur + delay >= totalMs) return;
      const g = glucoseVal.current;
      const pct = (cur + delay) / (totalMs || (24 * 3600000)), simH = pct * 24;
      const simTime = fmtSimTime(simH);
      const driveH = parseInt(profile.driveTime?.split(":")[0] || "9"), exH = parseInt(profile.exerciseTime?.split(":")[0] || "17");
      let alert;
      if (profile.willDrive && !specialRef.current.driving && simH >= driveH && simH < driveH + 1) {
        specialRef.current.driving = true; alert = { ...buildDrivingScenario(profile.country, g), _simTime: simTime };
      } else if (profile.willExercise && !specialRef.current.exercise && simH >= exH && simH < exH + 1) {
        specialRef.current.exercise = true; alert = { ...buildExerciseScenario(profile.country, g, profile.exerciseType), _simTime: simTime };
      } else {
        const mt = getMealType(pct);
        if (mt && Math.random() < .7) {
          specialRef.current.meals[mt] = true;
          setActiveMealType(mt); setMealPhase("input"); setMealCarbs(45); setMealFiber(5); setMealFat(15); setMealInsulinTaken(3); setMealCalc(null);
          setMealSimTime(simTime);
          setScreen("meal"); scheduleNext(cur + delay); return;
        }
        alert = { ...ALERT_POOL[Math.floor(Math.random() * ALERT_POOL.length)], _simTime: simTime };
      }
      setAlertCount(n => n + 1); alertSensory(alert.tag || "nudge");
      setActiveAlert(alert); setSelected(null); setShowFeedback(false); setTimeLeft(25); setTimerActive(true); setScreen("alert");
    }, delay);
  }, [mode, totalMs, profile, getMealType, getDelay]);

  useEffect(() => {
    if (screen === "challenge" && !tappedOut) scheduleNext(elapsedMs.current);
    return () => clearTimeout(intervalRef.current);
  }, [screen, tappedOut, scheduleNext]);

  useEffect(() => {
    if (screen === "alert" && timerActive && !showFeedback) {
      alertTimerRef.current = setInterval(() => {
        setTimeLeft(t => { if (t <= 1) { clearInterval(alertTimerRef.current); setTimerActive(false); doDecision(-1); return 0; } return t - 1; });
      }, 1000);
    }
    return () => clearInterval(alertTimerRef.current);
  }, [screen, timerActive, showFeedback]);

  const getCtxKey = () => {
    if (activeAlert?._ctxOverride) return activeAlert._ctxOverride;
    if (!activeAlert?.contexts) return "default";
    const lim = totalMs || (24 * 3600000), simH = (elapsed / lim) * 24;
    const sleepH = parseInt(profile.sleepTime?.split(":")[0] || "23"), wakeH = parseInt(profile.wakeTime?.split(":")[0] || "7");
    if (simH >= sleepH || simH < wakeH) return "sleep";
    for (const ev of profile.events) { const evH = parseInt(ev.time?.split(":")[0] || "9"); if (Math.abs(simH - evH) <= 1) return ev.type; }
    if (simH >= 11 && simH <= 14) return "social";
    return "default";
  };
  const resolveOptions = (a, k) => { if (!a) return []; if (a.options && !Array.isArray(a.options)) return a.options[k] || a.options.default || []; return a.options || []; };
  const resolveQuestion = (a, k) => { if (!a) return ""; if (a.questions) return a.questions[k] || a.questions.default || ""; return a.question || ""; };

  const doDecision = i => {
    clearInterval(alertTimerRef.current); setTimerActive(false); setSelected(i); setShowFeedback(true);
    const opts = resolveOptions(activeAlert, getCtxKey());
    const correct = i >= 0 && opts[i]?.correct;
    setAlertHistory(h => [...h, { alert: activeAlert, selected: i, correct, timestamp: Date.now() }]);
  };

  const dismissAlert = () => { setScreen("challenge"); setActiveAlert(null); setSelected(null); setShowFeedback(false); scheduleNext(elapsedMs.current); };

  const finishMeal = insulinTaken => {
    const workoutProxMins = profile.willExercise ? Math.abs((parseInt(profile.exerciseTime?.split(":")[0] || "17") - (elapsed / (totalMs || 24 * 3600000)) * 24) * 60) : null;
    const rec = mealCalc || calcInsulin({ carbs: mealCarbs, fiber: mealFiber, fat: mealFat, currentGlucose: glucose, workoutProximityMins: workoutProxMins, workoutType: profile.exerciseType });
    setMealHistory(h => [...h, { mealType: activeMealType, carbs: mealCarbs, fiber: mealFiber, fat: mealFat, insulinTaken, recommended: rec.totalRecommended, workoutProximityMins: workoutProxMins, glucose, timestamp: Date.now() }]);
    setScreen("challenge"); scheduleNext(elapsedMs.current);
  };

  const finishChallenge = useCallback((completed = false) => {
    clearTimeout(intervalRef.current); clearInterval(elapsedRef.current); clearInterval(glucoseRef.current); clearInterval(alertTimerRef.current);
    setTappedOut(true);
    const hs = calcHealthScore({ mealDecisions: mealHistory, alertDecisions: alertHistory, totalAlerts: alertHistory.length });
    setHealthScore(hs); setScreen("results");
  }, [mealHistory, alertHistory]);

  const startChallenge = () => {
    specialRef.current = { driving: false, exercise: false, meals: {} };
    elapsedMs.current = 0;
    glucoseVal.current = 104;
    setChallengeStart(Date.now()); setElapsed(0); setAlertHistory([]); setMealHistory([]); setTappedOut(false); setGlucose(104); setHealthScore(null); setAlertCount(0); setMealSimTime(null); setScreen("challenge");
  };

  const unit = unitLabel(profile.country), gDisplay = toDisplay(glucose, profile.country), gColor = getGlucoseColor(glucose);
  const progPct = totalMs ? Math.min(100, (elapsed / totalMs) * 100) : 0;

  // Styles
  const css = `
    @keyframes fadeIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
    @keyframes flashIn { from { transform:scale(0.97); opacity:0 } to { transform:scale(1); opacity:1 } }
    * { box-sizing:border-box }
    button:focus, select:focus, input:focus { outline:none }
    input[type=range] { width:100%; accent-color:#00C8B4 }
    select option { background:#0A1929; color:#e2e8f0 }
    ::-webkit-scrollbar { width:3px }
    ::-webkit-scrollbar-thumb { background:#1e3a5f; border-radius:2px }
  `;
  const app = { minHeight: "100vh", background: "#040810", fontFamily: "-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif", color: "#e2e8f0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "16px" };
  const card = { width: "100%", maxWidth: "420px", animation: "fadeIn 0.4s ease" };
  const lbl = { fontSize: "9px", letterSpacing: "3px", color: "#00c8b4", textTransform: "uppercase", marginBottom: "6px", display: "block" };
  const inp = { width: "100%", background: "#0A1929", border: "1px solid rgba(0,200,180,0.5)", borderRadius: "8px", padding: "11px 13px", color: "#e2e8f0", fontSize: "13px", fontFamily: "-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif", outline: "none", boxSizing: "border-box" };
  const btn = (v = "primary", danger = false) => ({
    width: "100%", padding: "14px",
    background: v === "primary" ? "linear-gradient(135deg,#00c8b4,#0070f3)" : "transparent",
    border: v === "primary" ? "none" : `1px solid ${danger ? "rgba(220,38,38,0.5)" : "rgba(245,196,0,0.4)"}`,
    borderRadius: "9px",
    color: v === "primary" ? "#fff" : danger ? "#ef4444" : "#00c8b4",
    fontSize: "10px", fontWeight: "bold", letterSpacing: "2px", cursor: "pointer",
    fontFamily: "-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif", textTransform: "uppercase",
  });
  const panel = (a = "#00c8b4", p = "14px") => ({ background: `${a}07`, border: `1px solid ${a}20`, borderRadius: "9px", padding: p, marginBottom: "10px" });
  const grid = { position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", backgroundImage: "linear-gradient(rgba(0,200,180,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(0,200,180,0.025) 1px,transparent 1px)", backgroundSize: "40px 40px" };
  const cite = { fontSize: "9px", color: "#475569", marginTop: "6px", lineHeight: 1.5, fontStyle: "italic" };

  // ─── SCREENS ───────────────────────────────────────────────────────────────

  if (screen === "intro") return (
    <div style={app}><div style={grid} />
      <div style={card}>
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <div style={lbl}>A Type 1 Diabetes Simulator</div>
          <div style={{ fontSize: "clamp(72px,20vw,104px)", fontWeight: 900, color: "#00c8b4", lineHeight: .85, letterSpacing: "-4px" }}>180</div>
          <div style={{ fontSize: "clamp(13px,3.5vw,17px)", color: "#475569", letterSpacing: "5px", marginTop: "8px" }}>DECISIONS</div>
        </div>
        <div style={panel("#00c8b4", "16px")}>
          <p style={{ margin: "0 0 10px", fontSize: "13px", lineHeight: 1.8, color: "#94a3b8" }}>
            People with <span style={{ color: "#00c8b4", fontWeight: "bold" }}>Type 1 Diabetes</span> make approximately <span style={{ color: "#fff", fontWeight: "bold" }}>180 life-essential decisions</span> every day on a brain being starved of the very resource needed to make them.
          </p>
          <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.8, color: "#94a3b8" }}>
            This simulator interrupts your day with alerts as authentic to the diabetic experience as possible. At the end, it shows you where your choices lead.
          </p>
        </div>
        <button style={btn()} onClick={() => setScreen("onboard")}>Begin</button>
        <p style={{ textAlign: "center", fontSize: "8px", color: "#040810", marginTop: "14px", lineHeight: 1.6 }}>
          MindHack 2026 · Carleton University<br />
          Research: Stanford · The Lancet · DCCT/EDIC · Journal of Neuropsychiatry
        </p>
      </div>
      <style>{css}</style>
    </div>
  );

  if (screen === "onboard") {
    const steps = 4;
    return (
      <div style={app}><div style={grid} />
        <div style={card}>
          <div style={{ display: "flex", gap: "4px", marginBottom: "18px" }}>
            {Array.from({ length: steps }).map((_, i) => (
              <div key={i} style={{ flex: 1, height: "2px", borderRadius: "1px", background: i <= onboardStep ? "#00c8b4" : "rgba(255,255,255,0.07)", transition: "background 0.3s" }} />
            ))}
          </div>

          {onboardStep === 0 && <div style={{ animation: "fadeIn 0.4s ease" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 900, margin: "0 0 4px", color: "#fff" }}>Where are you from?</h2>
            <p style={{ fontSize: "11px", color: "#64748b", margin: "0 0 16px", lineHeight: 1.6 }}>Glucose readings will display in your country's standard units, based on the Abbott Diabetes Care International Reference Table.</p>
            <div style={{ marginBottom: "10px" }}>
              <div style={lbl}>Country</div>
              <select style={{ ...inp, cursor: "pointer" }} value={profile.country} onChange={e => setProfile(p => ({ ...p, country: e.target.value }))}>
                <option value="" style={{ background: "#0A1929", color: "#64748b" }}>Select country</option>
                {ALL_COUNTRIES.map(c => <option key={c} value={c} style={{ background: "#0A1929", color: "#e2e8f0" }}>{c} ({COUNTRY_UNITS[c]})</option>)}
              </select>
              {profile.country && <div style={{ marginTop: "5px", fontSize: "9px", color: usesMmol(profile.country) ? "#00c8b4" : "#D97706" }}>Readings in {unitLabel(profile.country)}</div>}
            </div>
            <div style={{ marginBottom: "10px" }}><div style={lbl}>Name</div><input style={inp} placeholder="First name or alias" value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} /></div>
            <div><div style={lbl}>Occupation</div><select style={{ ...inp, cursor: "pointer" }} value={profile.occupation} onChange={e => setProfile(p => ({ ...p, occupation: e.target.value }))}><option value="" style={{ background: "#0A1929", color: "#64748b" }}>Select occupation</option>{OCCUPATIONS.map(o => <option key={o} value={o} style={{ background: "#0A1929", color: "#e2e8f0" }}>{o}</option>)}</select></div>
          </div>}

          {onboardStep === 1 && <div style={{ animation: "fadeIn 0.4s ease" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 900, margin: "0 0 4px", color: "#fff" }}>Your schedule</h2>
            <p style={{ fontSize: "11px", color: "#64748b", margin: "0 0 14px", lineHeight: 1.6 }}>The algorithm targets your most important moments — alerts will be timed to interrupt you at the worst possible times.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
              <div><div style={lbl}>Wake time</div><input type="time" style={inp} value={profile.wakeTime} onChange={e => setProfile(p => ({ ...p, wakeTime: e.target.value }))} /></div>
              <div><div style={lbl}>Sleep time</div><input type="time" style={inp} value={profile.sleepTime} onChange={e => setProfile(p => ({ ...p, sleepTime: e.target.value }))} /></div>
            </div>
            <div style={{ marginBottom: "10px" }}>
              <div style={lbl}>Most important daily commitment (optional)</div>
              <p style={{ fontSize: "9px", color: "#475569", margin: "0 0 8px", lineHeight: 1.5 }}>The simulation will try to interrupt you during this. Driving and exercise are set on the next screen.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px" }}>
                <select style={{ ...inp, cursor: "pointer" }}
                  value={profile.events[0]?.type || ""}
                  onChange={e => {
                    const type = e.target.value;
                    if (!type) { setProfile(p => ({ ...p, events: [] })); return; }
                    setProfile(p => ({ ...p, events: [{ label: type, time: p.events[0]?.time || "09:00", type }] }));
                  }}>
                  <option value="" style={{ background: "#0A1929" }}>None</option>
                  <option value="meeting" style={{ background: "#0A1929" }}>Work meeting or class</option>
                  <option value="social" style={{ background: "#0A1929" }}>Social event or meal out</option>
                  <option value="workout" style={{ background: "#0A1929" }}>Workout or sport</option>
                </select>
                {profile.events[0]?.type && (
                  <input type="time" style={{ ...inp, width: "110px" }}
                    value={profile.events[0]?.time || "09:00"}
                    onChange={e => setProfile(p => ({ ...p, events: [{ ...p.events[0], time: e.target.value }] }))} />
                )}
              </div>
            </div>
          </div>}

          {onboardStep === 2 && <div style={{ animation: "fadeIn 0.4s ease" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 900, margin: "0 0 4px", color: "#fff" }}>Today's activities</h2>
            <p style={{ fontSize: "11px", color: "#64748b", margin: "0 0 14px", lineHeight: 1.6 }}>You will be intercepted before these, as T1D requires in real life.</p>
            {[
              { key: "willDrive", title: "Driving today?", sub: "Mandatory glucose check before you can drive", color: "#00c8b4", timeKey: "driveTime", timeLabel: "Drive time" },
              { key: "willExercise", title: "Exercising today?", sub: "Mandatory pre-exercise glucose decision", color: "#D97706", timeKey: "exerciseTime", timeLabel: "Exercise time", hasType: true },
            ].map(item => (
              <div key={item.key} style={{ ...panel(item.color, "12px"), cursor: "pointer" }} onClick={() => setProfile(p => ({ ...p, [item.key]: !p[item.key] }))}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: profile[item.key] ? "10px" : "0" }}>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: "bold", color: item.color, marginBottom: "1px" }}>{item.title}</div>
                    <div style={{ fontSize: "9px", color: "#475569" }}>{item.sub}</div>
                  </div>
                  <div style={{ width: "16px", height: "16px", borderRadius: "50%", background: profile[item.key] ? item.color : "rgba(255,255,255,0.04)", border: `1px solid ${item.color}40`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "9px", color: "#fff" }}>{profile[item.key] ? "v" : ""}</div>
                </div>
                {profile[item.key] && <div onClick={e => e.stopPropagation()} style={{ display: "grid", gridTemplateColumns: item.hasType ? "1fr 1fr" : "1fr", gap: "8px" }}>
                  <div><div style={lbl}>{item.timeLabel}</div><input type="time" style={inp} value={profile[item.timeKey]} onChange={e => setProfile(p => ({ ...p, [item.timeKey]: e.target.value }))} /></div>
                  {item.hasType && <div><div style={lbl}>Type</div><select style={{ ...inp, cursor: "pointer" }} value={profile.exerciseType} onChange={e => setProfile(p => ({ ...p, exerciseType: e.target.value }))} onClick={e => e.stopPropagation()}><option value="cardio" style={{ background: "#0A1929" }}>Cardio</option><option value="strength" style={{ background: "#0A1929" }}>Strength</option><option value="mixed" style={{ background: "#0A1929" }}>Mixed</option></select></div>}
                </div>}
              </div>
            ))}
          </div>}

          {onboardStep === 3 && <div style={{ animation: "fadeIn 0.4s ease" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 900, margin: "0 0 4px", color: "#fff" }}>Choose your challenge</h2>
            <p style={{ fontSize: "11px", color: "#64748b", margin: "0 0 14px", lineHeight: 1.6 }}>How long are you willing to live with this?</p>
            {[
              { id: "demo", t: "Demo Mode", sub: "2 minutes", d: "4 alerts, fixed schedule. Ideal for presentations." },
              { id: "timed", t: "Custom Duration", sub: "You choose", d: "Set how many hours. Full health trajectory at the end." },
              { id: "indefinite", t: "Indefinite", sub: "No time limit", d: "Run until you tap out." },
            ].map(m => (
              <div key={m.id} onClick={() => setMode(m.id)} style={{ background: mode === m.id ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.02)", border: `1px solid ${mode === m.id ? "rgba(0,200,180,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: "9px", padding: "12px", marginBottom: "7px", cursor: "pointer", transition: "all 0.2s" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "3px" }}>
                  <div style={{ fontSize: "12px", fontWeight: "bold", color: mode === m.id ? "#00c8b4" : "#e2e8f0" }}>{m.t} <span style={{ fontSize: "9px", color: "#475569", fontWeight: "normal" }}>  {m.sub}</span></div>
                  {mode === m.id && <span style={{ color: "#00c8b4", fontSize: "11px" }}>v</span>}
                </div>
                <div style={{ fontSize: "10px", color: "#64748b", lineHeight: 1.5 }}>{m.d}</div>
              </div>
            ))}
            {mode === "timed" && <div style={{ marginTop: "6px" }}>
              <div style={lbl}>Duration: {customHours} hour{customHours !== 1 ? "s" : ""}</div>
              <input type="range" min="1" max="24" value={customHours} onChange={e => setCustomHours(parseInt(e.target.value))} />
            </div>}
          </div>}

          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            <button style={{ ...btn("secondary"), width: "auto", padding: "13px 18px" }} onClick={() => onboardStep > 0 ? setOnboardStep(s => s - 1) : setScreen("intro")}>Back</button>
            <button style={btn()} onClick={() => { if (onboardStep < steps - 1) { setOnboardStep(s => s + 1); return; } if (!mode || !profile.country) return; startChallenge(); }}>
              {onboardStep < steps - 1 ? "Continue" : (mode && profile.country) ? "Start" : !profile.country ? "Select country" : "Select mode"}
            </button>
          </div>
        </div>
        <style>{css}</style>
      </div>
    );
  }

  if (screen === "challenge") return (
    <div style={app}><div style={grid} />
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
          <div>
            <div style={lbl}>{profile.name || "Your"} challenge</div>
            <div style={{ fontSize: "30px", fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: "-1px" }}>{formatDuration(elapsed)}</div>
            <div style={{ fontSize: "9px", color: "#475569", marginTop: "2px" }}>{mode === "demo" ? "2 min demo" : mode === "timed" ? `${customHours}hr challenge` : "indefinite"}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "9px", color: "#475569", letterSpacing: "2px", marginBottom: "2px" }}>GLUCOSE</div>
            <div style={{ fontSize: "30px", fontWeight: 900, color: gColor, lineHeight: 1, letterSpacing: "-1px" }}>{gDisplay}</div>
            <div style={{ fontSize: "9px", color: "#475569" }}>{glucoseTrend} {unit}</div>
          </div>
        </div>
        {totalMs && <div style={{ height: "2px", background: "rgba(255,255,255,0.06)", borderRadius: "1px", marginBottom: "10px" }}><div style={{ height: "100%", borderRadius: "1px", width: `${progPct}%`, background: "linear-gradient(135deg,#00c8b4,#0070f3)", transition: "width 1s linear" }} /></div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "5px", marginBottom: "10px" }}>
          {[{ l: "Alerts", v: alertCount }, { l: "Correct", v: alertHistory.filter(h => h.correct).length }, { l: "Meals", v: mealHistory.length }, { l: "Missed", v: alertHistory.filter(h => h.selected === -1).length }].map((st, i) => (
            <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "7px", padding: "9px 5px", textAlign: "center" }}>
              <div style={{ fontSize: "20px", fontWeight: 900, color: "#fff" }}>{st.v}</div>
              <div style={{ fontSize: "7px", color: "#475569", letterSpacing: "1px" }}>{st.l.toUpperCase()}</div>
            </div>
          ))}
        </div>
        {mode === "indefinite" && <div style={{ ...panel("#475569", "9px 12px"), marginBottom: "8px" }}><div style={{ fontSize: "9px", color: "#64748b", lineHeight: 1.6 }}>Alerts will interrupt your day at random intervals. Keep this tab open and sound on.</div></div>}
        <button onClick={() => finishChallenge(false)} style={btn("secondary", true)}>Tap Out</button>
      </div>
      <style>{css}</style>
    </div>
  );

  if (screen === "alert" && activeAlert) {
    const isSpecial = activeAlert.type === "driving" || activeAlert.type === "exercise";
    const ctxKey = getCtxKey();
    const alertQuestion = resolveQuestion(activeAlert, ctxKey);
    const alertOptions = resolveOptions(activeAlert, ctxKey);
    const aColor = activeAlert.statusColor || gColor;
    const aDisp = activeAlert.glucose ? toDisplay(activeAlert.glucose, profile.country) : gDisplay;
    const tPct = (timeLeft / 25) * 100;
    const tColor = timeLeft > 14 ? "#16A34A" : timeLeft > 7 ? "#D97706" : "#DC2626";
    return (
      <div style={app}><div style={grid} />
        <div style={card}>
          <div style={{ background: `${aColor}10`, border: `1.5px solid ${aColor}`, borderRadius: "11px", padding: "12px 15px", marginBottom: "10px", textAlign: "center", animation: "flashIn 0.2s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <div style={{ fontSize: "8px", letterSpacing: "3px", color: "#64748b" }}>{activeAlert.type === "driving" ? "DRIVING CHECK" : activeAlert.type === "exercise" ? "PRE-EXERCISE" : "CGM ALERT"}</div>
              {activeAlert._simTime && <div style={{ fontSize: "10px", fontWeight: "bold", color: "#64748b", letterSpacing: "1px" }}>{activeAlert._simTime}</div>}
            </div>
            {!isSpecial ? <>
              <div style={{ fontSize: "42px", fontWeight: 900, color: aColor, lineHeight: 1, letterSpacing: "-2px" }}>{aDisp}</div>
              <div style={{ fontSize: "9px", color: "#64748b", margin: "2px 0" }}>{unit}</div>
              <span style={{ background: aColor, color: "#fff", padding: "2px 10px", borderRadius: "20px", fontSize: "9px", fontWeight: "bold", letterSpacing: "2px" }}>{activeAlert.status}</span>
            </> : <>
              <div style={{ fontSize: "12px", fontWeight: "bold", color: "#fff", marginBottom: "3px" }}>{activeAlert.title}</div>
              {activeAlert.glucose && <div style={{ fontSize: "20px", fontWeight: 900, color: aColor }}>{aDisp} <span style={{ fontSize: "9px", color: "#64748b" }}>{unit}</span></div>}
            </>}
          </div>

          {!showFeedback && <div style={{ marginBottom: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "8px", color: "#475569", marginBottom: "3px" }}><span>TIME TO DECIDE</span><span style={{ color: tColor, fontWeight: "bold" }}>{timeLeft}s</span></div>
            <div style={{ height: "2px", background: "rgba(255,255,255,0.06)", borderRadius: "1px" }}><div style={{ height: "100%", width: `${tPct}%`, background: tColor, transition: "width 1s linear", borderRadius: "1px" }} /></div>
          </div>}

          <p style={{ fontSize: "13px", fontWeight: "bold", color: "#e2e8f0", margin: "0 0 8px", lineHeight: 1.5 }}>{alertQuestion}</p>

          <div style={{ display: "flex", flexDirection: "column", gap: "5px", marginBottom: "10px" }}>
            {alertOptions.map((opt, i) => {
              let bg = "rgba(255,255,255,0.03)", border = "1px solid rgba(255,255,255,0.07)", color = "#94a3b8";
              if (showFeedback && selected === i) { bg = opt.correct ? "rgba(22,163,74,0.12)" : "rgba(220,38,38,0.08)"; border = `1px solid ${opt.correct ? "#16A34A" : "#DC2626"}`; color = opt.correct ? "#86EFAC" : "#FCA5A5"; }
              else if (showFeedback && opt.correct) { bg = "rgba(22,163,74,0.07)"; border = "1px solid rgba(22,163,74,0.3)"; color = "#86EFAC"; }
              return <button key={i} onClick={() => !showFeedback && doDecision(i)} style={{ background: bg, border, borderRadius: "7px", padding: "10px 12px", color, fontSize: "11px", textAlign: "left", cursor: showFeedback ? "default" : "pointer", fontFamily: "-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif", lineHeight: 1.5, transition: "all 0.15s" }}>
                <span style={{ color: "#475569", marginRight: "7px", fontSize: "9px" }}>{String.fromCharCode(65 + i)}</span>{opt.text}
              </button>;
            })}
          </div>

          {showFeedback && selected === -1 && <div style={{ ...panel("#DC2626", "8px 12px"), marginBottom: "8px" }}><div style={{ fontSize: "10px", color: "#FCA5A5" }}>Time elapsed. In a real event, delay has consequences.</div></div>}

          {showFeedback && selected !== null && selected >= 0 && (
            <div style={{ ...panel("#00c8b4", "8px 12px"), marginBottom: "8px" }}>
              <div style={{ fontSize: "10px", color: "#93c5fd", lineHeight: 1.7 }}>{alertOptions[selected]?.feedback}</div>
            </div>
          )}

          {showFeedback && <ScienceDropdown science={activeAlert.science} />}

          {showFeedback && <button style={btn()} onClick={dismissAlert}>Continue</button>}
        </div>
        <style>{css}</style>
      </div>
    );
  }

  if (screen === "meal") {
    const mc = MEAL_CONTEXTS[activeMealType] || MEAL_CONTEXTS.lunch;
    const workoutProxMins = profile.willExercise ? Math.abs((parseInt(profile.exerciseTime?.split(":")[0] || "17") - (elapsed / (totalMs || 24 * 3600000)) * 24) * 60) : null;
    if (mealPhase === "input") return (
      <div style={app}><div style={grid} />
        <div style={card}>
          <div style={{ textAlign: "center", marginBottom: "12px" }}>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "10px", marginBottom: "3px" }}>
              <div style={{ fontSize: "8px", letterSpacing: "3px", color: "#64748b" }}>MEAL TIME</div>
              {mealSimTime && <div style={{ fontSize: "10px", fontWeight: "bold", color: "#64748b", letterSpacing: "1px" }}>{mealSimTime}</div>}
            </div>
            <div style={{ fontSize: "15px", fontWeight: "bold", color: "#fff" }}>{mc.label}</div>
            <div style={{ fontSize: "9px", color: "#64748b", marginTop: "2px" }}>{mc.desc}</div>
          </div>
          {[
            { label: "Carbohydrates", unit: "g", key: "carbs", val: mealCarbs, set: setMealCarbs, color: "#D97706", note: "Primary driver of glucose rise" },
            { label: "Fibre", unit: "g", key: "fiber", val: mealFiber, set: setMealFiber, color: "#16A34A", note: "Subtracts from net carbs" },
            { label: "Fat", unit: "g", key: "fat", val: mealFat, set: setMealFat, color: "#A78BFA", note: "Delays glucose peak by 1 to 3 hours" },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: "8px", padding: "10px 12px", background: "rgba(255,255,255,0.03)", border: `1px solid ${f.color}25`, borderRadius: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <div>
                  <div style={{ fontSize: "8px", color: f.color, letterSpacing: "1px", marginBottom: "1px" }}>{f.label.toUpperCase()}</div>
                  <div style={{ fontSize: "8px", color: "#475569" }}>{f.note}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <input
                    type="number" min="0" value={f.val}
                    onChange={e => { const v = parseInt(e.target.value); f.set(isNaN(v) || v < 0 ? 0 : v); }}
                    style={{ width: "70px", background: "#0a1929", border: `1px solid ${f.color}40`, borderRadius: "6px", padding: "7px 9px", color: f.color, fontSize: "16px", fontWeight: 900, fontFamily: "-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif", textAlign: "right", outline: "none" }}
                  />
                  <span style={{ fontSize: "11px", color: "#475569" }}>{f.unit}</span>
                </div>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#475569", marginBottom: "10px", padding: "8px 12px", background: "rgba(255,255,255,0.02)", borderRadius: "6px" }}>
            <span>Net carbs: <strong style={{ color: "#fff" }}>{Math.max(0, mealCarbs - mealFiber)}g</strong></span>
            <span>Glucose: <strong style={{ color: gColor }}>{gDisplay} {unit}</strong></span>
          </div>
          {workoutProxMins !== null && workoutProxMins <= 120 && <div style={{ ...panel("#DC2626", "7px 11px"), marginBottom: "8px" }}><div style={{ fontSize: "9px", color: "#FCA5A5" }}>{profile.exerciseType === "cardio" ? "Cardio" : "Strength training"} in approx. {Math.round(workoutProxMins)} min. This affects your dose.</div></div>}
          <button style={btn()} onClick={() => { const c = calcInsulin({ carbs: mealCarbs, fiber: mealFiber, fat: mealFat, currentGlucose: glucose, workoutProximityMins: workoutProxMins, workoutType: profile.exerciseType }); setMealCalc(c); setMealInsulinTaken(Math.round(c.totalRecommended * 10) / 10); setMealPhase("decide"); }}>Calculate Insulin</button>
        </div>
        <style>{css}</style>
      </div>
    );
    if (mealPhase === "decide" && mealCalc) return (
      <div style={app}><div style={grid} />
        <div style={card}>
          <div style={{ marginBottom: "10px", padding: "12px", background: "rgba(0,200,180,0.07)", border: "1px solid rgba(0,200,180,0.22)", borderRadius: "9px" }}>
            <div style={lbl}>Recommended dose</div>
            {mealCalc.breakdown.map((b, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", marginBottom: "6px", paddingBottom: "6px", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <span style={{ color: "#94a3b8" }}>{b.label}</span><span style={{ color: "#00c8b4", fontWeight: "bold" }}>{b.val}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", fontWeight: "bold" }}>
              <span style={{ color: "#fff" }}>Total</span><span style={{ color: "#00c8b4" }}>{mealCalc.totalRecommended}u</span>
            </div>
            <div style={cite}>{mealCalc.citation}</div>
          </div>
          {mealCalc.fatNote && <div style={{ ...panel("#A78BFA", "7px 11px"), marginBottom: "8px" }}><div style={{ fontSize: "9px", color: "#C4B5FD" }}>{mealCalc.fatNote}</div></div>}
          {mealCalc.workoutNote && <div style={{ ...panel("#D97706", "7px 11px"), marginBottom: "8px" }}><div style={{ fontSize: "9px", color: "#FCD34D" }}>{mealCalc.workoutNote}</div></div>}
          <div style={{ marginBottom: "10px", padding: "12px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "9px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={lbl}>Your dose</div>
                <div style={{ fontSize: "9px", color: "#475569", marginTop: "2px" }}>
                  Recommended: <span style={{ color: "#00c8b4", fontWeight: "bold" }}>{mealCalc.totalRecommended}u</span>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <input
                  type="number" min="0" step="0.5" value={mealInsulinTaken}
                  onChange={e => { const v = parseFloat(e.target.value); setMealInsulinTaken(isNaN(v) || v < 0 ? 0 : Math.round(v * 2) / 2); }}
                  style={{
                    width: "80px", background: "#0a1929",
                    border: `1px solid ${Math.abs(mealInsulinTaken - mealCalc.totalRecommended) / Math.max(mealCalc.totalRecommended, 1) <= .15 ? "#16A34A" : Math.abs(mealInsulinTaken - mealCalc.totalRecommended) / Math.max(mealCalc.totalRecommended, 1) <= .35 ? "#D97706" : "#DC2626"}`,
                    borderRadius: "8px", padding: "9px 11px", color: "#fff",
                    fontSize: "22px", fontWeight: 900,
                    fontFamily: "-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif",
                    textAlign: "right", outline: "none",
                  }}
                />
                <span style={{ fontSize: "13px", color: "#475569", fontWeight: "bold" }}>u</span>
              </div>
            </div>
            {mealInsulinTaken > mealCalc.totalRecommended * 1.5 && mealCalc.totalRecommended > 0 && <div style={{ marginTop: "8px", fontSize: "9px", color: "#FCA5A5" }}>Significant overdose. Hypoglycaemia likely in 2 to 3 hours.</div>}
            {mealInsulinTaken < mealCalc.totalRecommended * .5 && mealCalc.totalRecommended > 0 && <div style={{ marginTop: "8px", fontSize: "9px", color: "#FCA5A5" }}>Significant underdose. Extended high glucose likely after this meal.</div>}
          </div>
          <button style={btn()} onClick={() => finishMeal(mealInsulinTaken)}>Confirm and Continue</button>
          <p style={{ textAlign: "center", fontSize: "8px", color: "#040810", marginTop: "7px" }}>This decision affects your long-term health score.</p>
        </div>
        <style>{css}</style>
      </div>
    );
  }

  if (screen === "results") {
    const hs = healthScore || calcHealthScore({ mealDecisions: mealHistory, alertDecisions: alertHistory, totalAlerts: alertHistory.length });
    const tl = getTimeline(hs.overall, hs.estimatedA1c);
    const completed = mode === "demo" ? elapsed >= 1.9 * 60000 : mode === "timed" ? elapsed >= customHours * 3600000 * .95 : false;
    const sColor = hs.overall >= 80 ? "#16A34A" : hs.overall >= 55 ? "#D97706" : "#DC2626";
    const a1cColor = parseFloat(hs.estimatedA1c) < 7.5 ? "#16A34A" : parseFloat(hs.estimatedA1c) < 9 ? "#D97706" : "#DC2626";
    return (
      <div style={app}><div style={grid} />
        <div style={card}>
          <div style={{ textAlign: "center", marginBottom: "16px" }}>
            <div style={{ fontSize: "10px", color: "#475569", letterSpacing: "2px", marginBottom: "4px" }}>{completed ? "SIMULATION COMPLETE" : "AFTER ACTION REPORT"}</div>
            <div style={{ fontSize: "26px", fontWeight: 900, color: "#fff", letterSpacing: "-1px" }}>{formatDuration(elapsed)}</div>
            <div style={{ fontSize: "9px", color: "#475569", marginTop: "2px" }}>{completed ? "You completed the full simulation." : "You tapped out here."}</div>
          </div>

          <div style={{ padding: "14px", background: `${sColor}07`, border: `1px solid ${sColor}20`, borderRadius: "9px", marginBottom: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
              <div>
                <div style={lbl}>Health Score</div>
                <div style={{ fontSize: "44px", fontWeight: 900, color: sColor, lineHeight: 1, letterSpacing: "-2px" }}>{hs.overall}</div>
                <div style={{ fontSize: "9px", color: sColor, marginTop: "1px" }}>{tl.label}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ ...lbl, textAlign: "right" }}>Est. HbA1c</div>
                <div style={{ fontSize: "26px", fontWeight: 900, color: a1cColor, letterSpacing: "-1px" }}>{hs.estimatedA1c}%</div>
                <div style={{ fontSize: "8px", color: "#475569" }}>target below 7.0%</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "5px" }}>
              {[
                { l: "Alert accuracy", v: `${hs.alertAccuracy}%`, c: hs.alertAccuracy >= 70 ? "#16A34A" : "#DC2626" },
                { l: "Meal accuracy", v: hs.mealAccuracy !== null ? `${hs.mealAccuracy}%` : "no meals", c: hs.mealAccuracy !== null ? (hs.mealAccuracy >= 70 ? "#16A34A" : "#DC2626") : "#475569" },
                { l: "Insulin overdoses", v: hs.overdoses, c: hs.overdoses === 0 ? "#16A34A" : hs.overdoses <= 2 ? "#D97706" : "#DC2626" },
                { l: "Missed alerts", v: hs.missed, c: hs.missed === 0 ? "#16A34A" : hs.missed <= 3 ? "#D97706" : "#DC2626" },
              ].map((st, i) => (
                <div key={i} style={{ background: "rgba(0,0,0,0.2)", borderRadius: "6px", padding: "8px 10px" }}>
                  <div style={{ fontSize: "16px", fontWeight: 900, color: st.c }}>{st.v}</div>
                  <div style={{ fontSize: "8px", color: "#475569", marginTop: "1px" }}>{st.l.toUpperCase()}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: "12px", background: "rgba(220,38,38,0.05)", border: "1px solid rgba(220,38,38,0.15)", borderRadius: "9px", marginBottom: "8px" }}>
            <div style={{ ...lbl, color: "#EF4444", marginBottom: "10px" }}>If this were your real life</div>
            {tl.items.map((t, i) => (
              <div key={i} style={{ display: "flex", gap: "10px", marginBottom: i < tl.items.length - 1 ? "10px" : "0", paddingBottom: i < tl.items.length - 1 ? "10px" : "0", borderBottom: i < tl.items.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                <div style={{ minWidth: "52px", flexShrink: 0 }}>
                  <div style={{ fontSize: "8px", color: "#EF4444", fontWeight: "bold", marginBottom: "2px" }}>{t.year}</div>
                  <div style={{ fontSize: "9px", color: "#e2e8f0", fontWeight: "bold", lineHeight: 1.4 }}>{t.consequence}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.7 }}>{t.desc}</div>
                </div>
              </div>
            ))}
            <div style={{ fontSize: "9px", color: "#475569", marginTop: "10px", lineHeight: 1.5, fontStyle: "italic" }}>{tl.citation}</div>
          </div>

          <div style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.8, marginBottom: "12px", padding: "10px 13px", background: "rgba(255,255,255,0.03)", borderRadius: "7px", fontStyle: "italic", textAlign: "center" }}>
            The people in your life with diabetes carry this every day.<br />With no option to tap out.
          </div>

          <button style={btn("secondary")} onClick={() => { setScreen("intro"); setOnboardStep(0); setMode(null); setAlertHistory([]); setMealHistory([]); setElapsed(0); }}>Start Again</button>
        </div>
        <style>{css}</style>
      </div>
    );
  }
  return null;
}
