// Reviewed browsing categories. These describe appearance, not vendor guarantees.
// Unknown/imported faces remain Other rather than guessing from their filenames.
const groups = {
  sans: ['hershey-roman-simplex','hershey-roman-duplex','plot-sans','inter','inter-italic','square-bot-sans','hershey-futural','hershey-futuram','pf-hershey-sans-1-stroke','pf-hershey-sans-medium','pf-twin-sans','pf-ems-swiss','pf-ems-tech','pf-ems-osmotron','pf-ems-league','pf-custom-square-normal','pf-custom-square-italic'],
  serif: ['hershey-roman-triplex','hershey-roman-italic','hershey-roman-bold-italic','hershey-roman-complex','hershey-roman-bold','hershey-timesg','pf-hershey-serif-bold','pf-hershey-serif-bold-italic','pf-hershey-serif-medium','pf-hershey-serif-medium-italic','pf-ems-capitol','pf-ems-herculean','pf-ems-readability','pf-ems-readability-italic'],
  script: ['hershey-cursive','hershey-script-simplex','hershey-script-complex','pf-hershey-script-1-stroke','pf-hershey-script-medium','pf-custom-script','pf-dearplotter','pf-ems-allure','pf-ems-bird','pf-ems-bird-swash-caps','pf-ems-brush','pf-ems-casual-hand','pf-ems-decorous-script','pf-ems-delight','pf-ems-delight-swash-caps','pf-ems-elfin','pf-ems-felix','pf-ems-invite','pf-ems-little-princess','pf-ems-neato','pf-ems-pepita','pf-ems-qwandry','pf-ems-society'],
  blackletter: ['hershey-gothgbt','hershey-gothgrt','hershey-gothiceng','hershey-gothicger','hershey-gothicita','hershey-gothitt','pf-hershey-gothic-english','pf-hershey-gothic-german','pf-hershey-gothic-italian'],
  technical: ['pf-norm-stroke','pf-cad-iso3098','pf-cad-iso3098-i','pf-cad-lc-opengost-ar','pf-cad-lc-opengost-br'],
  symbols: ['hershey-astrology','hershey-markers','hershey-mathlow','hershey-mathupp','hershey-meteorology','hershey-music','hershey-symbolic'],
  decorative: ['pf-relief-singleline-ornament','pf-relief-singleline-svg','pf-cutlingsdualis','pf-cutlingspluralis','pf-cutlingssingularis','pf-ems-misty-night','pf-ems-nixish','pf-ems-nixish-italic','pf-ems-pancakes','pf-ems-spacerocks']
};
export const fontStyles=Object.fromEntries(Object.entries(groups).flatMap(([style,ids])=>ids.map(id=>[id,style])));
