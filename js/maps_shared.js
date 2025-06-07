export function getColor(d, mapType) {
    if (mapType === 'result') {
	    return d > .8 ? '#800026' :
	    	d > .7  ? '#BD0026' :
	    	d > .6  ? '#E31A1C' :
	    	d > .4  ? '#FC4E2A' :
	    	d > .2   ? '#FD8D3C' :
	    	d > .1   ? '#FEB24C' :
	    	d > .05   ? '#FED976' : '#FFEDA0';
     } else {
        if (d <= -0.85) return colors[0];
        if (d <= -0.7) return colors[1];
        if (d <= -0.25) return colors[2];
        if (d <= -0.125) return colors[3];
        if (d <= 0.125) return colors[4];
        if (d <= 0.25) return colors[5];
        if (d <= 0.5) return colors[6];
        if (d <= 1.) return colors[7];
        if (d > 1.) return colors[8];
        return null;
     }
}

const colors = [ // red/blue
  '#b2182b',
  '#d6604d',
  '#f4a582',
  '#fddbc7',
  '#f7f7f7',
  '#d1e5f0',
  '#92c5de',
  '#4393c3',
  '#2166ac',
];

export function style(feature, mapType) {
    var key;
    if (mapType === 'result') {
        key = 'value_prop';
    } else{
        key = 'delta';
    }
	return {
		weight: 2,
		opacity: 1,
		color: 'white',
		dashArray: '3',
		fillOpacity: 0.7,
        fillColor: getColor(feature.properties[key], mapType),
	};
}

export function highlightFeature(e) {
	var layer = e.target;

	layer.setStyle({
		weight: 5,
		color: '#666',
		dashArray: '',
		fillOpacity: 0.7
	});

	if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
		layer.bringToFront();
	}
}

export function createLegend(mapType) {
  var newLegend = L.control({position: 'bottomleft'});
  var grades;
  if (mapType === 'result') {
    grades = [0, 0.05, 0.1, .2, .4, .6, .7, .8]; 
  } else {
    var grades = [-1, -0.75, -0.5, -0.25, -0.125, 0.125, 0.25, 0.5, 1.];
  }
  newLegend.onAdd = function (map) {

      var div = L.DomUtil.create('div', 'info legend');
      var labels = [];
      var from, to;

      for (var i = 0; i < grades.length; i++) {
          from = grades[i];
          to = grades[i + 1];

          labels.push(
              '<i style="background:' + getColor(from + 0.0001, mapType) + '"></i> ' +
              from + ((to || (to===0.)) ? '&ndash;' + to : '+'));
      }

      div.innerHTML = labels.join('<br>');
      return div;
  };
  return newLegend;
}


export function getFeatureColor(feature, mapType='result') {
  let val;
  if (mapType==='result') {
      val = feature.properties[`value_prop`];
  } else {
      val = feature.properties[`delta`];
  };
  return {
    fillColor: getColor(val, mapType),
  };
}

export function JsonToTable(data) {
    const skip = ['place', 'region_name', 'invalid', 'municipality_name'];
    const renameMap = { // TODO move to shared
        'invalid' : 'Невалидни',
        'eligible_voters' : 'По списък',
        'n_stations' : 'Секции',
        'invalid' : 'Невалидни',
        'total' : 'Общо гласували',
        'npn' : 'Не подкрепям никого',
    }

    let thead = '<table><thead><tr><th>Дата</th>';
    for (let key in data) {
        if (!skip.includes(key))  {
            thead += `<th>${renameMap[key]||key}</th>`;
        }
    }
    thead += '</tr></thead>';
    
    let tbody = '<tbody>';

    const dates = Object.keys(data.eligible_voters);

    dates.forEach(date => {
        tbody += `<tr><td>${date}</td>`;
        for (let key in data) {
            if (!skip.includes(key)) tbody += `<td>${data[key][date]}</td>`;
        }
        tbody += '</tr>';
    });
    tbody += '</tbody></table>';

    return thead + tbody;
}

