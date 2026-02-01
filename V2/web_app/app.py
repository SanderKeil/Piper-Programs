#!/usr/bin/env python3
# -*-coding:utf8-*-
import sys
import os
import atexit

# Add local libs directory to sys.path
sys.path.append(os.path.join(os.path.dirname(__file__), 'libs'))

from flask import Flask, render_template, request, jsonify
from robot_controller import RobotController
import config

app = Flask(__name__)

# Initialize Controller
robot_ctrl = RobotController()

def cleanup():
    print("Shutting down...")
    robot_ctrl.stop_heartbeat()

atexit.register(cleanup)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/joints')
def joints():
    return render_template('joints.html')

@app.route('/api/connect_can', methods=['POST'])
def connect_can():
    # Ensure connection
    if not robot_ctrl.piper:
        if not robot_ctrl.connect():
             return jsonify({'success': False, 'message': 'Failed to initialize robot on CAN'}), 500
    
    # Start heartbeat if not running
    robot_ctrl.start_heartbeat()
    
    return jsonify({'success': True, 'message': 'CAN connection established'})

@app.route('/api/enable_can', methods=['POST'])
def enable_can():
    if not robot_ctrl.piper:
         return jsonify({"success": False, "message": "Robot not connected"}), 500
         
    success, msg = robot_ctrl.enable_can_mode()
    if success:
        return jsonify({"success": True, "message": msg})
    else:
        return jsonify({"success": False, "message": msg}), 500

@app.route('/api/current_state', methods=['GET'])
def get_current_state():
    state = robot_ctrl.get_state()
    if not state:
        return jsonify({'success': False, 'message': 'Robot not connected'})
    
    # Process into frontend friendly format if needed
    # The controller returns raw integers for safety, we convert here for display API
    # Or strict forwarding. Let's do conversion here to match old API.
    
    try:
        j = state['joints']
        p = state['end_pose']
        
        return jsonify({
            'success': True,
            'joints': {
                'j1': j['j1'] / 1000.0,
                'j2': j['j2'] / 1000.0,
                'j3': j['j3'] / 1000.0,
                'j4': j['j4'] / 1000.0,
                'j5': j['j5'] / 1000.0,
                'j6': j['j6'] / 1000.0
            },
            'gripper': state['gripper'] / 1000.0,
            'end_pose': {
                'x': p['x'] / 1000.0,
                'y': p['y'] / 1000.0,
                'z': p['z'] / 1000.0,
                'rx': p['rx'] / 1000.0,
                'ry': p['ry'] / 1000.0,
                'rz': p['rz'] / 1000.0
            },
            'meta': state['meta']
        })
    except Exception as e:
         return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/move', methods=['POST'])
def move_pose():
    if not robot_ctrl.piper:
        return jsonify({'success': False, 'message': 'Robot not connected'})

    try:
        data = request.json
        # Convert inputs (mm/deg) to robot units (x1000)
        pose = [
            int(float(data.get('x', 0)) * 1000),
            int(float(data.get('y', 0)) * 1000),
            int(float(data.get('z', 0)) * 1000),
            int(float(data.get('rx', 0)) * 1000),
            int(float(data.get('ry', 0)) * 1000),
            int(float(data.get('rz', 0)) * 1000)
        ]
        
        speed = int(data.get('speed', config.DEFAULT_SPEED))
        speed = max(0, min(100, speed))
        
        robot_ctrl.update_pose_target(pose, speed)
        
        # Handle gripper if present in payload
        if 'gripper' in data:
            g_val = int(float(data.get('gripper', 0)) * 1000)
            robot_ctrl.update_gripper(g_val)
            
        return jsonify({'success': True, 'message': 'Command sent'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/move_joints', methods=['POST'])
def move_joints():
    if not robot_ctrl.piper:
        return jsonify({'success': False, 'message': 'Robot not connected'})

    try:
        data = request.json
        joints = [
            int(float(data.get('j1', 0)) * 1000),
            int(float(data.get('j2', 0)) * 1000),
            int(float(data.get('j3', 0)) * 1000),
            int(float(data.get('j4', 0)) * 1000),
            int(float(data.get('j5', 0)) * 1000),
            int(float(data.get('j6', 0)) * 1000)
        ]
        
        speed = int(data.get('speed', config.DEFAULT_SPEED))
        
        # Check for linear Move mode override
        move_mode = int(data.get('move_mode', config.MOVE_MODE_JOINT))
        
        if move_mode == config.MOVE_MODE_LINEAR:
             # This endpoint was overloaded in old app to handle linear moves too? 
             # Let's keep logic simple: if linear requested, we expect end_pose
             end_pose_in = data.get('end_pose')
             if end_pose_in:
                 target_end_pose = [int(float(v)*1000) for v in end_pose_in]
                 robot_ctrl.current_move_config["move_mode"] = config.MOVE_MODE_LINEAR
                 robot_ctrl.update_pose_target(target_end_pose, speed)
             else:
                 return jsonify({'success': False, 'message': 'Linear mode requires end_pose'}), 400
        else:
            robot_ctrl.update_joint_target(joints, speed)
        
        if 'gripper' in data:
             g_val = int(float(data.get('gripper', 0)) * 1000)
             eff = int(data.get('effort', config.DEFAULT_GRIPPER_EFFORT))
             robot_ctrl.update_gripper(g_val, eff)

        return jsonify({'success': True, 'message': 'Joint command sent'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/move_gripper', methods=['POST'])
def move_gripper():
    if not robot_ctrl.piper:
        return jsonify({'success': False, 'message': 'Robot not connected'})

    try:
        data = request.json
        gripper = int(data.get('gripper', 0)) * 1000
        effort = int(data.get('effort', config.DEFAULT_GRIPPER_EFFORT))
        
        robot_ctrl.update_gripper(gripper, effort)
        
        return jsonify({'success': True, 'message': 'Gripper command sent'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

if __name__ == '__main__':
    # Auto-connect if possible
    if robot_ctrl.connect():
        robot_ctrl.start_heartbeat()
    
    app.run(host='0.0.0.0', port=5000, debug=True)
