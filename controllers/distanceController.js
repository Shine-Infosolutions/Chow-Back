const getCoordinates = async (pincode) => {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&countrycodes=in&postalcode=${pincode}&limit=1`,
      { headers: { 'User-Agent': 'ChowApp/1.0' } }
    );
    const data = await response.json();
    return data[0] ? [parseFloat(data[0].lon), parseFloat(data[0].lat)] : null;
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
};

const calculateDistance = async (req, res) => {
  try {
    const { pincode } = req.body;
    
    if (!pincode || !/^[1-9][0-9]{5}$/.test(pincode)) {
      return res.status(400).json({ message: 'Invalid pincode' });
    }

    const [baseCoords, userCoords] = await Promise.all([
      getCoordinates(process.env.BASE_PINCODE || '273001'),
      getCoordinates(pincode)
    ]);

    if (!baseCoords || !userCoords) {
      return res.status(200).json({
        success: false,
        message: 'Pincode not serviceable',
        distance: null,
        fee: null
      });
    }

    // Try OSRM first
    try {
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${baseCoords[0]},${baseCoords[1]};${userCoords[0]},${userCoords[1]}?overview=false`
      );
      const data = await response.json();
      
      if (data.routes?.[0]?.distance) {
        const distance = Math.round(data.routes[0].distance / 1000 * 100) / 100;
        return res.json({ 
          success: true,
          distance, 
          fee: calculateFee(distance) 
        });
      }
    } catch (error) {
      console.error('OSRM error:', error);
    }

    // Fallback to Haversine
    const distance = haversineDistance(baseCoords[1], baseCoords[0], userCoords[1], userCoords[0]);
    res.json({ 
      success: true,
      distance, 
      fee: calculateFee(distance) 
    });

  } catch (error) {
    console.error('Distance calculation error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error calculating distance',
      distance: null,
      fee: null
    });
  }
};

const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) * 100) / 100;
};

const calculateFee = (distance) => {
  const fees = [[5, 25], [15, 40], [50, 70], [100, 100], [300, 150], [600, 200]];
  return fees.find(([limit]) => distance <= limit)?.[1] || 300;
};

module.exports = { calculateDistance };