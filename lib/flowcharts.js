// IT's procedure flowcharts (sections 10.1.2, 10.2 and 10.5 of the procedure
// document), as data for app/components/Flowchart.js. The wording in every box
// is the document's own, spelling included: this page mirrors it, it does not
// rewrite it. Coordinates are box centres on each chart's own canvas.
const start = (x, y, w, h, ...text) => ({ t: "start", x, y, w, h, text });
const step = (x, y, w, h, ...text) => ({ t: "step", x, y, w, h, text });
const decision = (x, y, w, h, ...text) => ({ t: "decision", x, y, w, h, text });
const edge = (pts, label, at) => ({ pts, label, at });

export const REQUEST = {
  title: "Flowchart 8: IT Hardware Request System", width: 640, height: 715,
  nodes: [
    start(300, 40, 230, 46, "Requester submit IT Hardware", "Request System"),
    step(300, 105, 220, 34, "Submit to HOD for approval"),
    decision(300, 185, 140, 80, "Get HOD", "approval"),
    step(90, 185, 150, 40, "Notify and discuss", "with requester"),
    decision(300, 300, 140, 80, "Get IT HOD", "approval"),
    step(520, 300, 150, 40, "Notify and discuss", "with HOD"),
    decision(300, 415, 160, 80, "Stock availability"),
    step(520, 470, 150, 40, "IT dept. to purchase", "new unit"),
    decision(520, 560, 130, 90, "Get", "management", "approval"),
    step(300, 560, 210, 56, "IT dept. to issue IT Hardware", "Handover and Return System for", "user"),
    start(300, 660, 200, 34, "Complete"),
  ],
  edges: [
    edge([[300, 63], [300, 88]]),
    edge([[300, 122], [300, 145]]),
    edge([[230, 185], [165, 185]], "Rejected", [176, 178]),
    edge([[300, 225], [300, 260]], "Approved", [306, 246]),
    edge([[370, 300], [445, 300]], "Rejected", [386, 293]),
    edge([[300, 340], [300, 375]], "Approved", [306, 361]),
    edge([[380, 415], [520, 415], [520, 450]], "No", [392, 408]),
    edge([[300, 455], [300, 532]], "Yes", [306, 480]),
    edge([[520, 490], [520, 515]]),
    edge([[455, 560], [405, 560]], "Approved", [410, 553]),
    edge([[520, 605], [520, 660], [400, 660]], "Rejected", [526, 628]),
    edge([[300, 588], [300, 643]]),
    edge([[90, 205], [90, 660], [200, 660]]),
    edge([[595, 300], [625, 300], [625, 700], [300, 700], [300, 677]]),
  ],
};

export const HANDOVER = {
  title: "Flowchart 15: hardware handover or loan to user", width: 300, height: 475,
  nodes: [
    start(140, 45, 230, 60, "IT dept. to issue IT Hardware", "Handover & Return System for", "user"),
    decision(140, 145, 150, 80, "Get IT HOD for", "approval"),
    step(140, 245, 230, 40, "Submit to user for", "acknowledgement through email"),
    step(140, 315, 230, 40, "User signed and revert through", "email"),
    step(140, 385, 230, 40, "IT dept. keep copy changes to", "system update"),
    start(140, 450, 220, 32, "Complete"),
  ],
  edges: [
    edge([[140, 75], [140, 105]]),
    edge([[140, 185], [140, 225]], "Approved", [146, 208]),
    edge([[215, 145], [285, 145], [285, 450], [250, 450]], "Rejected", [226, 138]),
    edge([[140, 265], [140, 295]]),
    edge([[140, 335], [140, 365]]),
    edge([[140, 405], [140, 434]]),
  ],
};

export const RETURN = {
  title: "Flowchart 16: hardware return from user", width: 280, height: 345,
  nodes: [
    start(140, 40, 220, 44, "User to return devices"),
    step(140, 115, 240, 40, "IT department to aware all", "accessories and device sufficient"),
    step(140, 185, 240, 40, "User signed on return section in", "same form during handover"),
    step(140, 255, 240, 40, "IT dept. keep copy changes to", "system update"),
    start(140, 320, 220, 32, "Complete"),
  ],
  edges: [
    edge([[140, 62], [140, 95]]),
    edge([[140, 135], [140, 165]]),
    edge([[140, 205], [140, 235]]),
    edge([[140, 275], [140, 304]]),
  ],
};

export const LOAN = {
  title: "Flowchart 18: IT Loan Accessories, loan", width: 460, height: 385,
  nodes: [
    start(340, 40, 220, 46, "IT dept. to check accessories", "sufficiency"),
    decision(340, 135, 150, 80, "Accessories", "sufficiency"),
    step(105, 135, 190, 34, "Inform user on insufficency"),
    step(105, 220, 190, 34, "IT dept. plan to purchase item"),
    step(105, 295, 190, 34, "Submit to IT HOD for approval"),
    step(340, 225, 200, 56, "IT dept. issue IT Loan", "Acccessories for user through", "email"),
    step(340, 295, 200, 34, "User acknowledged"),
    start(340, 360, 190, 32, "Complete"),
  ],
  edges: [
    edge([[340, 63], [340, 95]]),
    edge([[265, 135], [200, 135]], "No", [228, 128]),
    edge([[340, 175], [340, 197]], "Yes", [346, 190]),
    edge([[105, 152], [105, 203]]),
    edge([[105, 237], [105, 278]]),
    edge([[200, 295], [240, 295]]),
    edge([[340, 253], [340, 278]]),
    edge([[340, 312], [340, 344]]),
  ],
};

export const LOAN_RETURN = {
  title: "Flowchart 18: IT Loan Accessories, return", width: 460, height: 385,
  nodes: [
    start(340, 40, 230, 46, "Loaner get notified if accessories", "not returned yet"),
    decision(340, 135, 170, 80, "Accessories returned"),
    step(105, 225, 190, 34, "IT dept. acknowledged"),
    step(340, 225, 220, 40, "Loaner kept receive notification", "to return accessories loaned"),
    step(340, 295, 220, 40, "IT department will request", "directly for return"),
    start(340, 360, 190, 32, "Complete"),
  ],
  edges: [
    edge([[340, 63], [340, 95]]),
    edge([[255, 135], [105, 135], [105, 208]], "Yes", [228, 128]),
    edge([[340, 175], [340, 205]], "No", [346, 193]),
    edge([[340, 245], [340, 275]]),
    edge([[340, 315], [340, 344]]),
    edge([[105, 242], [105, 360], [245, 360]]),
  ],
};
