// One-off (2026-10-27): which kinds of address does HtmlOutput.setFaviconUrl accept? Delete afterwards.
function run_once_favicon_check(){
  var tries = {
    'png address': 'https://www.gstatic.com/images/branding/product/1x/apps_script_48dp.png',
    'address without extension': 'https://lh3.googleusercontent.com/d/abc',
    'data URI': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'drive image + #.png': 'https://lh3.googleusercontent.com/d/abc#.png',
    'drive image + ?.png': 'https://lh3.googleusercontent.com/d/abc?f=.png',
    'drive uc + &.png': 'https://drive.google.com/uc?export=view&id=abc&x=.png'
  };
  Object.keys(tries).forEach(function(k){
    try { HtmlService.createHtmlOutput('x').setFaviconUrl(tries[k]); Logger.log(k + ': accepted'); }
    catch (e) { Logger.log(k + ': refused (' + e.message + ')'); }
  });
  ensure_settings_tabs();
  Logger.log('FAVICON_URL row present: ' + ('FAVICON_URL' in read_settings_tab() || 'check the Automation tab'));
}
