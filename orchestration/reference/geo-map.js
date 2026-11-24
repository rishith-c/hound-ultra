(() => {
  if (!window.maplibregl) return;

  const host = document.getElementById('geo-map');
  const center = [lon0, lat0];
  const relief = {pitch: 43, bearing: -12, zoom: 16.35};
  const overhead = {pitch: 0, bearing: 0, zoom: 16.35};
  const elevation = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const satellite = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false';
  const status = document.querySelector('.credit');
  const flatAlert = status.textContent;
  const anchor = point => {
    const [lat,lon] = toLatLon(point);
    return [lon,lat];
  };
  const features = (...featureList) => ({type:'FeatureCollection',features:featureList});
  const feature = (type, coordinates, properties={}) => ({type:'Feature',geometry:{type,coordinates},properties});
  const poly = (points,properties) => feature('Polygon',[[...points,points[0]].map(anchor)],properties);
  const line = (points,properties) => feature('LineString',points.map(anchor),properties);
  const source = data => ({type:'geojson',data});
  const shakeAreas = d3.contours().size([W,H]).thresholds([7,7.5,8,8.5])(mm).map(contour =>
    feature('MultiPolygon',contour.coordinates.map(polygon=>polygon.map(ring=>ring.map(([x,y])=>anchor([x*SC,y*SC])))),{intensity:contour.value})
  );
  let map;
  let ready = false;
  let mode3D = true;

  host.classList.add('geo-loading');
  try {
    map = new maplibregl.Map({
      container:host, center, ...relief, maxPitch:82, minZoom:12, maxZoom:19.75,
      attributionControl:false,
      style:{
        version:8,
        glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        light:{anchor:'viewport',position:[1.5,210,34],color:'#fff1df',intensity:.45},
        sources:{
          imagery:{type:'raster',tiles:[satellite],tileSize:256,maxzoom:18},
          mapped:{type:'vector',url:'https://tiles.openfreemap.org/planet'},
          terrain:{type:'raster-dem',tiles:[elevation],encoding:'terrarium',tileSize:256,maxzoom:14},
          shade:{type:'raster-dem',tiles:[elevation],encoding:'terrarium',tileSize:256,maxzoom:14},
          zones:source(features(...DMG.map((points,i)=>poly(points,{height:[11,8,6][i]})))),
          shaking:source(features(...shakeAreas)),
          paths:source(features(line(SWEEP,{kind:'sweep'}),line(CORR,{kind:'blocked'}))),
          route:source(features()),
          heat:source(features(feature('Point',anchor(GOAL))))
        },
        terrain:{source:'terrain',exaggeration:.86},
        layers:[
          {id:'ground',type:'background',paint:{'background-color':'#293d4d'}},
          {id:'imagery',type:'raster',source:'imagery',paint:{'raster-saturation':-.16,'raster-contrast':.08,'raster-brightness-max':.99,'raster-resampling':'linear'}},
          {id:'elevation',type:'hillshade',source:'shade',paint:{'hillshade-exaggeration':.22,'hillshade-shadow-color':'#132035','hillshade-highlight-color':'#e7dec6'}},
          {id:'shake',type:'fill',source:'shaking',paint:{'fill-color':'#ff7b47','fill-opacity':['interpolate',['linear'],['get','intensity'],7,.035,8.5,.15],'fill-outline-color':'#db875a'}},
          {id:'river-fill',type:'fill',source:'mapped','source-layer':'water',paint:{'fill-color':'#4a96ab','fill-opacity':.48}},
          {id:'river-line',type:'line',source:'mapped','source-layer':'waterway',filter:['==',['get','class'],'river'],paint:{'line-color':'#7ac0d1','line-width':2.1,'line-opacity':.8}},
          {id:'road-edge',type:'line',source:'mapped','source-layer':'transportation',filter:['match',['get','class'],['motorway','trunk','primary','secondary','tertiary','minor','service'],true,false],layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#18282e','line-width':['interpolate',['linear'],['zoom'],13,1.3,17,4.2],'line-opacity':.88}},
          {id:'roads',type:'line',source:'mapped','source-layer':'transportation',filter:['match',['get','class'],['motorway','trunk','primary','secondary','tertiary','minor','service'],true,false],layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':['match',['get','class'],['motorway','trunk','primary'],'#efc68d','#c2cdd1'],'line-width':['interpolate',['linear'],['zoom'],13,.55,17,2],'line-opacity':.9}},
          {id:'mapped-buildings',type:'fill-extrusion',minzoom:15,source:'mapped','source-layer':'building',paint:{'fill-extrusion-color':'#d1ccc0','fill-extrusion-height':['max',3,['to-number',['get','render_height'],5]],'fill-extrusion-opacity':.87}},
          {id:'damage',type:'fill-extrusion',source:'zones',paint:{'fill-extrusion-color':'#cd795b','fill-extrusion-height':['get','height'],'fill-extrusion-opacity':.78}},
          {id:'sweep',type:'line',source:'paths',filter:['==',['get','kind'],'sweep'],paint:{'line-color':'#d0e5ef','line-width':2,'line-opacity':.64,'line-dasharray':[1,2]}},
          {id:'blocked',type:'line',source:'paths',filter:['==',['get','kind'],'blocked'],paint:{'line-color':'#ff8563','line-width':3,'line-dasharray':[2,2]}},
          {id:'route-border',type:'line',source:'route',paint:{'line-color':'#12253d','line-width':8}},
          {id:'route',type:'line',source:'route',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#96e6ff','line-width':4}},
          {id:'place-name',type:'symbol',source:'mapped','source-layer':'place',layout:{'text-field':['coalesce',['get','name:en'],['get','name']],'text-font':['Noto Sans Regular'],'text-size':13,'text-offset':[0,-.45]},paint:{'text-color':'#f5fbfb','text-halo-color':'#11242b','text-halo-width':1.25}},
          {id:'heat',type:'heatmap',source:'heat',layout:{visibility:'none'},paint:{'heatmap-radius':70,'heatmap-intensity':1.15,'heatmap-opacity':.65}}
        ]
      }
    });
  } catch {
    host.classList.remove('geo-loading');
    return;
  }

  function makeMarker(label, person=false) {
    const marker = document.createElement('div');
    marker.className = 'geo-marker' + (person?' person':'');
    const text = document.createElement('span');
    text.textContent = label;
    marker.append(text);
    return new maplibregl.Marker({element:marker});
  }
  const unit = makeMarker('HOUND-01');
  const detection = makeMarker('ROOM 112 · SIMULATED',true);
  let shown = false;
  let lastRoute;
  function syncLayers() {
    document.querySelectorAll('.mtools [data-l]').forEach(button => {
      const layer = {img:'imagery',elev:'elevation',shake:'shake',dmg:'damage',heat:'heat'}[button.dataset.l];
      const visible = button.classList.contains('on') && (layer!=='heat'||S.found);
      map.setLayoutProperty(layer,'visibility',visible?'visible':'none');
    });
  }
  function update() {
    if (!ready) return;
    unit.setLngLat(anchor(S.pos));
    if (S.found!==shown) {
      shown=S.found;
      if(shown) detection.setLngLat(anchor(GOAL)).addTo(map);
      else detection.remove();
      syncLayers();
    }
    if (plan !== lastRoute) {
      if (plan) map.getSource('route').setData(features(line(plan)));
      else if (!S.arrived) map.getSource('route').setData(features());
      lastRoute=plan;
    }
  }

  const timeout = setTimeout(() => {
    if (ready) return;
    host.classList.remove('geo-loading');
    map.remove();
  },10000);
  map.once('load', () => {
    clearTimeout(timeout);
    ready=true;
    mapEl.classList.add('webgl-ready');
    status.innerHTML='Timure, Nepal · imagery © Esri, Maxar · elevation: Mapzen · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> · simulated response';
    unit.setLngLat(anchor(S.pos)).addTo(map);
    syncLayers();
    setInterval(update,80);
    new ResizeObserver(()=>map.resize()).observe(mapEl);
  });

  for (const [id,action] of [
    ['terrain-toggle',()=>{
      mode3D=!mode3D;
      document.getElementById('terrain-toggle').setAttribute('aria-pressed',String(mode3D));
      map.easeTo({pitch:mode3D?relief.pitch:0,bearing:mode3D?relief.bearing:0,duration:650});
    }],
    ['zin',()=>map.zoomIn()],
    ['zout',()=>map.zoomOut()],
    ['zfit',()=>map.easeTo({center,...(mode3D?relief:overhead),duration:550})]
  ]) document.getElementById(id).addEventListener('click',event=>{
    if(!ready)return;
    event.stopImmediatePropagation();
    action();
  },true);

  document.querySelector('.mtools').addEventListener('click',()=>{if(ready)syncLayers();});
  map.getCanvas().addEventListener('webglcontextlost',()=>{
    ready=false;
    mapEl.classList.remove('webgl-ready');
    status.textContent=flatAlert;
  });
})();
