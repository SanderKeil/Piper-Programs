#!/usr/bin/env python3
# -*-coding:utf8-*-
import sys
import os
import time
# Add local libs directory to sys.path
sys.path.append(os.path.join(os.path.dirname(__file__), 'libs'))

from piper_sdk import *

def enable_fun(piper:C_PiperInterface_V2, enable:bool):
    '''
    使能机械臂并检测使能状态,尝试5s,如果使能超时则退出程序
    '''
    enable_flag = False
    loop_flag = False
    # 设置超时时间（秒）
    timeout = 5
    # 记录进入循环前的时间
    start_time = time.time()
    elapsed_time_flag = False
    while not (loop_flag):
        elapsed_time = time.time() - start_time
        enable_list = []
        enable_list.append(piper.GetArmLowSpdInfoMsgs().motor_1.foc_status.driver_enable_status)
        enable_list.append(piper.GetArmLowSpdInfoMsgs().motor_2.foc_status.driver_enable_status)
        enable_list.append(piper.GetArmLowSpdInfoMsgs().motor_3.foc_status.driver_enable_status)
        enable_list.append(piper.GetArmLowSpdInfoMsgs().motor_4.foc_status.driver_enable_status)
        enable_list.append(piper.GetArmLowSpdInfoMsgs().motor_5.foc_status.driver_enable_status)
        enable_list.append(piper.GetArmLowSpdInfoMsgs().motor_6.foc_status.driver_enable_status)
        if(enable):
            enable_flag = all(enable_list)
            piper.EnableArm(7)
            piper.GripperCtrl(0,1000,0x01, 0)
        else:
            enable_flag = any(enable_list)
            piper.DisableArm(7)
            piper.GripperCtrl(0,1000,0x02, 0)
        
        if(enable_flag == enable):
            loop_flag = True
            enable_flag = True
        else: 
            loop_flag = False
            enable_flag = False
        # 检查是否超过超时时间
        if elapsed_time > timeout:
            print(f"超时....")
            elapsed_time_flag = True
            enable_flag = False
            loop_flag = True
            break
        time.sleep(0.5)
    return enable_flag

if __name__ == "__main__":
    piper = C_PiperInterface_V2("can0")
    piper.ConnectPort()
    
    # Enable the arm first
    print("Enabling arm...")
    piper.EnableArm(7)
    enable_fun(piper=piper, enable=True)
    
    # Target position
    position = [55.0, 0.0, 206.0, 0, 85.0, 0, 0]
    factor = 1000
    
    X = round(position[0]*factor)
    Y = round(position[1]*factor)
    Z = round(position[2]*factor)
    RX = round(position[3]*factor)
    RY = round(position[4]*factor)
    RZ = round(position[5]*factor)
    joint_6 = round(position[6]*factor)
    
    print("Moving to zero position...")
    # Mode control: 0x01 for position control
    piper.MotionCtrl_2(0x01, 0x00, 100, 0x00)
    piper.EndPoseCtrl(X,Y,Z,RX,RY,RZ)
    piper.GripperCtrl(abs(joint_6), 1000, 0x01, 0)
    
    # Wait for command to be sent and executed
    time.sleep(3) 
    print("Move command sent. Exiting.")
    exit(0)
