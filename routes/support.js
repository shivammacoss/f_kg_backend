const express = require('express');
const router = express.Router();
const SupportTicket = require('../models/SupportTicket');
const { protect } = require('../middleware/auth');

// @route   GET /api/support/tickets
// @desc    Get user's support tickets
// @access  Private
router.get('/tickets', protect, async (req, res) => {
  try {
    const { status } = req.query;
    const query = { userId: req.user._id };
    if (status && status !== 'all') query.status = status;

    const tickets = await SupportTicket.find(query)
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .select('-messages');

    res.json({ success: true, data: tickets });
  } catch (error) {
    console.error('Get tickets error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/support/tickets/:id
// @desc    Get single ticket with messages
// @access  Private
router.get('/tickets/:id', protect, async (req, res) => {
  try {
    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    // Mark admin messages as read
    ticket.messages.forEach(msg => {
      if (msg.sender === 'admin' && !msg.readAt) {
        msg.readAt = new Date();
      }
    });
    await ticket.save();

    res.json({ success: true, data: ticket });
  } catch (error) {
    console.error('Get ticket error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/support/tickets
// @desc    Create new support ticket
// @access  Private
router.post('/tickets', protect, async (req, res) => {
  try {
    const { subject, category, priority, message } = req.body;

    if (!subject || !message) {
      return res.status(400).json({ success: false, message: 'Subject and message are required' });
    }

    const ticket = await SupportTicket.create({
      userId: req.user._id,
      subject,
      category: category || 'general',
      priority: priority || 'medium',
      messages: [{
        sender: 'user',
        senderName: `${req.user.firstName} ${req.user.lastName}`,
        message
      }],
      lastMessageAt: new Date(),
      lastMessageBy: 'user'
    });

    res.status(201).json({ success: true, data: ticket });
  } catch (error) {
    console.error('Create ticket error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/support/tickets/:id/message
// @desc    Send message to ticket
// @access  Private
router.post('/tickets/:id/message', protect, async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    if (ticket.status === 'closed') {
      return res.status(400).json({ success: false, message: 'Cannot reply to closed ticket' });
    }

    ticket.messages.push({
      sender: 'user',
      senderName: `${req.user.firstName} ${req.user.lastName}`,
      message
    });
    ticket.lastMessageAt = new Date();
    ticket.lastMessageBy = 'user';
    if (ticket.status === 'resolved') {
      ticket.status = 'open'; // Reopen if user replies
    }

    await ticket.save();

    res.json({ success: true, data: ticket });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/support/tickets/:id/close
// @desc    Close ticket
// @access  Private
router.put('/tickets/:id/close', protect, async (req, res) => {
  try {
    const ticket = await SupportTicket.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { status: 'closed' },
      { new: true }
    );

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    res.json({ success: true, data: ticket });
  } catch (error) {
    console.error('Close ticket error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/support/tickets/:id/rate
// @desc    Rate resolved ticket
// @access  Private
router.put('/tickets/:id/rate', protect, async (req, res) => {
  try {
    const { score, feedback } = req.body;

    const ticket = await SupportTicket.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id, status: { $in: ['resolved', 'closed'] } },
      { rating: { score, feedback } },
      { new: true }
    );

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found or not resolved' });
    }

    res.json({ success: true, data: ticket });
  } catch (error) {
    console.error('Rate ticket error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/support/unread
// @desc    Get unread message count
// @access  Private
router.get('/unread', protect, async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ userId: req.user._id });
    let unreadCount = 0;
    
    tickets.forEach(ticket => {
      ticket.messages.forEach(msg => {
        if (msg.sender === 'admin' && !msg.readAt) {
          unreadCount++;
        }
      });
    });

    res.json({ success: true, data: { unreadCount } });
  } catch (error) {
    console.error('Get unread error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
