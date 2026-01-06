const { distanceService } = require('../services');

const calculateDistance = async (req, res) => {
  try {
    const { pincode } = req.body;
    
    if (!pincode || !/^[1-9][0-9]{5}$/.test(pincode)) {
      return res.status(400).json({ message: 'Invalid pincode' });
    }

    const distance = await distanceService.calculateDistance(
      process.env.BASE_PINCODE || '273001',
      pincode
    );

    if (!distance) {
      return res.status(200).json({
        success: false,
        message: 'Pincode not serviceable',
        distance: null,
        fee: null
      });
    }

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

const calculateFee = (distance) => {
  const fees = [[5, 25], [15, 40], [50, 70], [100, 100], [300, 150], [600, 200]];
  return fees.find(([limit]) => distance <= limit)?.[1] || 300;
};

module.exports = { calculateDistance };