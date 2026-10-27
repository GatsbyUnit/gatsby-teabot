// One-off (2026-10-27): checks the name list of the page without a link, and sends Jan his own link through
// the new route (one email to Jan). Delete afterwards.
function run_once_link_check(){
  var people = api_link_people();
  Logger.log(people.length + ' names listed, e.g. ' + people.slice(0, 3).map(function(p){ return p.name; }).join(', '));
  var jan = people.filter(function(p){ return p.name === 'Jan Bauer'; })[0];
  Logger.log(jan ? api_request_link(jan.id) : 'Jan not listed');
}
