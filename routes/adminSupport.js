const express = require('express');
const router = express.Router();
const SupportTicket = require('../models/SupportTicket');
const { protectAdmin } = require('./adminAuth');

// @route   GET /api/admin/support/stats
// @desc    Get support stats
// @access  Admin
router.get('/stats', protectAdmin, async (req, res) => {
  try {
    const [open, inProgress, resolved, closed, total] = await Promise.all([
      SupportTicket.countDocuments({ status: 'open' }),
      SupportTicket.countDocuments({ status: 'in_progress' }),
      SupportTicket.countDocuments({ status: 'resolved' }),
      SupportTicket.countDocuments({ status: 'closed' }),
      SupportTicket.countDocuments()
    ]);

    // Unread messages count
    const tickets = await SupportTicket.find({ status: { $in: ['open', 'in_progress'] } });
    let unreadCount = 0;
    tickets.forEach(ticket => {
      ticket.messages.forEach(msg => {
        if (msg.sender === 'user' && !msg.readAt) unreadCount++;
      });
    });

    res.json({
      success: true,
      data: { open, inProgress, resolved, closed, total, unreadCount }
    });
  } catch (error) {
    console.error('Get support stats error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/admin/support/tickets
// @desc    Get all support tickets
// @access  Admin
router.get('/tickets', protectAdmin, async (req, res) => {
  try {
    const { status, priority, category, page = 1, limit = 20 } = req.query;
    const query = {};
    
    if (status && status !== 'all') query.status = status;
    if (priority && priority !== 'all') query.priority = priority;
    if (category && category !== 'all') query.category = category;

    const tickets = await SupportTicket.find(query)
      .populate('userId', 'firstName lastName email')
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await SupportTicket.countDocuments(query);

    res.json({
      success: true,
      data: tickets,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('Get tickets error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/admin/support/tickets/:id
// @desc    Get single ticket with messages
// @access  Admin
router.get('/tickets/:id', protectAdmin, async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id)
      .populate('userId', 'firstName lastName email phone');

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    // Mark user messages as read
    let updated = false;
    ticket.messages.forEach(msg => {
      if (msg.sender === 'user' && !msg.readAt) {
        msg.readAt = new Date();
        updated = true;
      }
    });
    if (updated) await ticket.save();

    res.json({ success: true, data: ticket });
  } catch (error) {
    console.error('Get ticket error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/admin/support/tickets/:id/reply
// @desc    Reply to ticket
// @access  Admin
router.post('/tickets/:id/reply', protectAdmin, async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    const ticket = await SupportTicket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    ticket.messages.push({
      sender: 'admin',
      senderName: req.admin.name || 'Support Team',
      message
    });
    ticket.lastMessageAt = new Date();
    ticket.lastMessageBy = 'admin';
    if (ticket.status === 'open') {
      ticket.status = 'in_progress';
    }

    await ticket.save();

    res.json({ success: true, data: ticket });
  } catch (error) {
    console.error('Reply ticket error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/support/tickets/:id/status
// @desc    Update ticket status
// @access  Admin
router.put('/tickets/:id/status', protectAdmin, async (req, res) => {
  try {
    const { status } = req.body;

    const updateData = { status };
    if (status === 'resolved') {
      updateData.resolvedAt = new Date();
      updateData.resolvedBy = req.admin._id;
    }

    const ticket = await SupportTicket.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate('userId', 'firstName lastName email');

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    res.json({ success: true, data: ticket });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/support/tickets/:id/priority
// @desc    Update ticket priority
// @access  Admin
router.put('/tickets/:id/priority', protectAdmin, async (req, res) => {
  try {
    const { priority } = req.body;

    const ticket = await SupportTicket.findByIdAndUpdate(
      req.params.id,
      { priority },
      { new: true }
    );

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    res.json({ success: true, data: ticket });
  } catch (error) {
    console.error('Update priority error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
